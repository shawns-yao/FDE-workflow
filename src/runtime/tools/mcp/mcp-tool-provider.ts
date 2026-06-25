import type { ErrorObject } from "../../../common/contracts.js";
import type { CoreTool, ToolProvider, ToolProviderContext } from "../core-tool.js";

export interface McpToolDefinition {
  server_name: string;
  tool_name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface McpToolClient {
  authenticate?(): Promise<void>;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(serverName: string, toolName: string, input: unknown): Promise<unknown>;
}

export interface McpToolProviderOptions {
  client: McpToolClient;
  name?: string;
  server_name?: string;
  refresh_interval_ms?: number;
  now?: () => number;
}

export type McpToolProviderInput = McpToolClient | McpToolProviderOptions;

export function createMcpToolProvider(input: McpToolProviderInput): ToolProvider {
  const options = isProviderOptions(input) ? input : { client: input };
  return new ManagedMcpToolProvider(options);
}

class ManagedMcpToolProvider implements ToolProvider {
  readonly name: string;
  readonly source = "mcp" as const;

  private readonly client: McpToolClient;
  private readonly serverName?: string;
  private readonly refreshIntervalMs: number;
  private readonly now: () => number;
  private started = false;
  private cachedDefinitions: McpToolDefinition[] = [];
  private lastRefreshAt = 0;

  constructor(options: McpToolProviderOptions) {
    this.name = options.name ?? "mcp";
    this.client = options.client;
    this.serverName = options.server_name;
    this.refreshIntervalMs = options.refresh_interval_ms ?? 60000;
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    try {
      await this.client.authenticate?.();
      await this.client.connect?.();
      this.started = true;
    } catch (error) {
      throw new McpProviderError(normalizeMcpError(error, "MCP provider authentication or connection failed."));
    }
  }

  async stop(): Promise<void> {
    try {
      await this.client.disconnect?.();
    } finally {
      this.started = false;
      this.cachedDefinitions = [];
      this.lastRefreshAt = 0;
    }
  }

  async refreshTools(context: ToolProviderContext): Promise<CoreTool[]> {
    if (!shouldStartForAllowedTools(context.allowed_tools, this.serverName)) {
      return [];
    }
    await this.ensureStarted();
    try {
      this.cachedDefinitions = await this.client.listTools();
      this.lastRefreshAt = this.now();
      return this.toCoreTools(context, this.cachedDefinitions);
    } catch (error) {
      throw new McpProviderError(normalizeMcpError(error, "MCP tool discovery failed."));
    }
  }

  async listTools(context: ToolProviderContext): Promise<CoreTool[]> {
    if (!shouldStartForAllowedTools(context.allowed_tools, this.serverName)) {
      return [];
    }
    await this.ensureStarted();
    if (this.shouldRefresh()) {
      return this.refreshTools(context);
    }
    return this.toCoreTools(context, this.cachedDefinitions);
  }

  private async ensureStarted(): Promise<void> {
    if (!this.started) {
      await this.start();
    }
  }

  private shouldRefresh(): boolean {
    return this.cachedDefinitions.length === 0 || this.now() - this.lastRefreshAt >= this.refreshIntervalMs;
  }

  private toCoreTools(context: ToolProviderContext, definitions: McpToolDefinition[]): CoreTool[] {
    return definitions
      .map((definition) => this.toCoreTool(definition))
      .filter((tool) => context.allowed_tools.some((allowedTool) => allowedTool === tool.name));
  }

  private toCoreTool(definition: McpToolDefinition): CoreTool {
    const name = buildMcpToolName(definition.server_name, definition.tool_name);
    const client = this.client;
    return {
      name,
      description: definition.description,
      input_schema: definition.input_schema,
      source: "mcp",
      source_name: normalizeMcpName(definition.server_name),
      async call(input) {
        try {
          const output = await client.callTool(definition.server_name, definition.tool_name, input);
          return {
            status: "succeeded",
            output
          };
        } catch (error) {
          const errorObject = normalizeMcpError(error, "MCP tool call failed.", {
            server_name: normalizeMcpName(definition.server_name),
            tool_name: normalizeMcpName(definition.tool_name),
            runtime_tool_name: name
          });
          return {
            status: errorObject.code === "AUTHENTICATION_FAILED" || errorObject.code === "PERMISSION_DENIED" ? "blocked" : "failed",
            error: errorObject
          };
        }
      }
    };
  }
}

export class McpProviderError extends Error {
  constructor(readonly error: ErrorObject) {
    super(error.message);
    this.name = "McpProviderError";
  }
}

export function normalizeMcpError(error: unknown, fallbackMessage: string, details: Record<string, unknown> = {}): ErrorObject {
  if (isErrorObjectCarrier(error)) {
    return {
      ...error.error,
      details: {
        ...details,
        ...error.error.details
      }
    };
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  const lowerMessage = message.toLowerCase();
  const code = lowerMessage.includes("auth") || lowerMessage.includes("token")
    ? "AUTHENTICATION_FAILED"
    : lowerMessage.includes("permission") || lowerMessage.includes("forbidden")
      ? "PERMISSION_DENIED"
      : "UPSTREAM_UNAVAILABLE";

  return {
    code,
    message,
    retryable: code === "UPSTREAM_UNAVAILABLE",
    severity: code === "UPSTREAM_UNAVAILABLE" ? "warning" : "error",
    details
  };
}

export function buildMcpToolName(serverName: string, toolName: string): `mcp__${string}__${string}` {
  return `mcp__${normalizeMcpName(serverName)}__${normalizeMcpName(toolName)}`;
}

function normalizeMcpName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isProviderOptions(input: McpToolProviderInput): input is McpToolProviderOptions {
  return "client" in input;
}

function isErrorObjectCarrier(error: unknown): error is { error: ErrorObject } {
  if (error === null || typeof error !== "object" || !("error" in error)) {
    return false;
  }
  return (error as { error?: unknown }).error !== null && typeof (error as { error?: unknown }).error === "object";
}

function shouldStartForAllowedTools(allowedTools: string[], serverName?: string): boolean {
  if (!serverName) {
    return allowedTools.some((tool) => tool.startsWith("mcp__"));
  }
  return allowedTools.some((tool) => tool.startsWith(`mcp__${serverName}__`));
}
