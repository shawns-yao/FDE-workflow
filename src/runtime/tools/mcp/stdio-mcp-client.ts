import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ErrorObject } from "../../../common/contracts.js";
import type { McpToolClient, McpToolDefinition } from "./mcp-tool-provider.js";

const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export interface StdioMcpServerConfig {
  server_name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  required_env?: string[];
  protocol_version?: string;
  request_timeout_ms?: number;
}

export type StdioMcpSpawn = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    stdio: ["pipe", "pipe", "pipe"];
  }
) => ChildProcessWithoutNullStreams;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timeout: NodeJS.Timeout;
  method: string;
}

interface McpListToolsResult {
  tools?: Array<{
    name?: unknown;
    description?: unknown;
    inputSchema?: unknown;
  }>;
}

interface McpCallToolResult {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

export class StdioMcpClient implements McpToolClient {
  private child?: ChildProcessWithoutNullStreams;
  private stdoutBuffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stderrTail = "";
  private closing = false;

  constructor(
    private readonly config: StdioMcpServerConfig,
    private readonly spawnImpl: StdioMcpSpawn = spawn
  ) {}

  async authenticate(): Promise<void> {
    const missing = (this.config.required_env ?? []).filter((key) => {
      const configuredValue = this.config.env?.[key] ?? process.env[key];
      return !configuredValue;
    });
    if (missing.length > 0) {
      throw new StdioMcpTransportError({
        code: "AUTHENTICATION_FAILED",
        message: "MCP server required environment variables are missing.",
        retryable: false,
        severity: "error",
        details: {
          server_name: this.config.server_name,
          missing_env: missing
        }
      });
    }
  }

  async connect(): Promise<void> {
    if (this.child) {
      return;
    }

    this.closing = false;
    this.child = this.spawnImpl(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: {
        ...process.env,
        ...this.config.env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => this.captureStderr(chunk));
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("exit", (code, signal) => {
      if (!this.closing) {
        this.failAll(new Error(`MCP server exited unexpectedly: code=${code ?? "null"} signal=${signal ?? "null"}`));
      }
      this.child = undefined;
    });

    try {
      await this.request("initialize", {
        protocolVersion: this.config.protocol_version ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "fde-workstation",
          version: "0.1.0"
        }
      });
      this.notify("notifications/initialized", {});
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.child) {
      return;
    }
    this.closing = true;
    this.failAll(new Error("MCP client disconnected."));
    this.child.stdin.end();
    this.child.kill();
    this.child = undefined;
    this.stdoutBuffer = Buffer.alloc(0);
    this.stderrTail = "";
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request<McpListToolsResult>("tools/list", {});
    const tools = Array.isArray(result.tools) ? result.tools : [];
    return tools
      .filter((tool): tool is { name: string; description?: unknown; inputSchema?: unknown } => typeof tool.name === "string")
      .map((tool) => ({
        server_name: this.config.server_name,
        tool_name: tool.name,
        description: typeof tool.description === "string" ? tool.description : `MCP tool ${this.config.server_name}.${tool.name}`,
        input_schema: isRecord(tool.inputSchema) ? tool.inputSchema : { type: "object", properties: {} }
      }));
  }

  async callTool(_serverName: string, toolName: string, input: unknown): Promise<unknown> {
    const result = await this.request<McpCallToolResult>("tools/call", {
      name: toolName,
      arguments: isRecord(input) ? input : {}
    });
    if (result.isError) {
      throw new StdioMcpTransportError({
        code: "UPSTREAM_UNAVAILABLE",
        message: extractMcpToolErrorMessage(result),
        retryable: false,
        severity: "error",
        details: {
          server_name: this.config.server_name,
          tool_name: toolName
        }
      });
    }
    return result.structuredContent ?? result.content ?? result;
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const timeoutMs = this.config.request_timeout_ms ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new StdioMcpTransportError({
          code: "UPSTREAM_UNAVAILABLE",
          message: `MCP request timed out: ${method}`,
          retryable: true,
          severity: "warning",
          details: {
            server_name: this.config.server_name,
            method,
            timeout_ms: timeoutMs
          }
        }));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
        method
      });

      try {
        this.writeMessage({
          jsonrpc: "2.0",
          id,
          method,
          params
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private notify(method: string, params: unknown): void {
    this.writeMessage({
      jsonrpc: "2.0",
      method,
      params
    });
  }

  private writeMessage(message: unknown): void {
    if (!this.child) {
      throw new StdioMcpTransportError({
        code: "UPSTREAM_UNAVAILABLE",
        message: "MCP server is not connected.",
        retryable: true,
        severity: "warning",
        details: {
          server_name: this.config.server_name
        }
      });
    }
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
    this.child.stdin.write(Buffer.concat([header, body]));
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }
      const header = this.stdoutBuffer.subarray(0, headerEnd).toString("ascii");
      const contentLength = parseContentLength(header);
      if (contentLength === undefined) {
        this.failAll(new Error("MCP response is missing Content-Length header."));
        return;
      }
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.stdoutBuffer.length < bodyEnd) {
        return;
      }
      const body = this.stdoutBuffer.subarray(bodyStart, bodyEnd).toString("utf8");
      this.stdoutBuffer = this.stdoutBuffer.subarray(bodyEnd);
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(body) as JsonRpcResponse;
    } catch (error) {
      this.failAll(error);
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`MCP ${pending.method} failed: ${message.error.message}`));
      return;
    }
    pending.resolve(message.result);
  }

  private captureStderr(chunk: Buffer): void {
    this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-2000);
  }

  private failAll(error: unknown): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export class StdioMcpTransportError extends Error {
  constructor(readonly error: ErrorObject) {
    super(error.message);
    this.name = "StdioMcpTransportError";
  }
}

function parseContentLength(header: string): number | undefined {
  for (const line of header.split("\r\n")) {
    const [key, value] = line.split(":");
    if (key?.toLowerCase() === "content-length") {
      const parsed = Number.parseInt(value.trim(), 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  return undefined;
}

function extractMcpToolErrorMessage(result: McpCallToolResult): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((item) => isRecord(item) && typeof item.text === "string" ? item.text : undefined)
    .filter((item): item is string => Boolean(item))
    .join("\n");
  return text || "MCP tool returned an error result.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
