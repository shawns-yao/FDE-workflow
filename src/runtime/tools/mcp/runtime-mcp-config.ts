import type { ErrorObject } from "../../../common/contracts.js";
import type { ToolProvider } from "../core-tool.js";
import { createMcpToolProvider } from "./mcp-tool-provider.js";
import { StdioMcpClient, type StdioMcpServerConfig, type StdioMcpSpawn } from "./stdio-mcp-client.js";

export const RUNTIME_MCP_SERVERS_ENV = "FDE_RUNTIME_MCP_SERVERS";

export interface RuntimeMcpServerConfig extends StdioMcpServerConfig {
  transport: "stdio";
  enabled?: boolean;
  refresh_interval_ms?: number;
}

export interface RuntimeMcpConfigLoadOptions {
  env?: NodeJS.ProcessEnv;
  spawn?: StdioMcpSpawn;
}

export function loadRuntimeMcpServerConfigsFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeMcpServerConfig[] {
  const raw = env[RUNTIME_MCP_SERVERS_ENV];
  if (!raw || raw.trim() === "") {
    return [];
  }
  return parseRuntimeMcpServerConfigs(raw);
}

export function parseRuntimeMcpServerConfigs(raw: string): RuntimeMcpServerConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RuntimeMcpConfigError(configError("Runtime MCP server config is not valid JSON.", { cause: errorMessage(error) }));
  }
  if (!Array.isArray(parsed)) {
    throw new RuntimeMcpConfigError(configError("Runtime MCP server config must be a JSON array."));
  }
  return parsed.map((item, index) => normalizeRuntimeMcpServerConfig(item, index));
}

export function createRuntimeMcpToolProvidersFromEnv(options: RuntimeMcpConfigLoadOptions = {}): ToolProvider[] {
  const configs = loadRuntimeMcpServerConfigsFromEnv(options.env);
  return createRuntimeMcpToolProviders(configs, options);
}

export function createRuntimeMcpToolProviders(
  configs: RuntimeMcpServerConfig[],
  options: Pick<RuntimeMcpConfigLoadOptions, "spawn"> = {}
): ToolProvider[] {
  return configs
    .filter((config) => config.enabled !== false)
    .map((config) => {
      const client = new StdioMcpClient(config, options.spawn);
      return createMcpToolProvider({
        client,
        name: `mcp:${config.server_name}`,
        server_name: normalizeMcpServerName(config.server_name),
        refresh_interval_ms: config.refresh_interval_ms
      });
    });
}

export class RuntimeMcpConfigError extends Error {
  constructor(readonly error: ErrorObject) {
    super(error.message);
    this.name = "RuntimeMcpConfigError";
  }
}

function normalizeRuntimeMcpServerConfig(value: unknown, index: number): RuntimeMcpServerConfig {
  if (!isRecord(value)) {
    throw new RuntimeMcpConfigError(configError("Runtime MCP server config item must be an object.", { index }));
  }
  const transport = value.transport ?? "stdio";
  if (transport !== "stdio") {
    throw new RuntimeMcpConfigError(configError("Unsupported Runtime MCP transport.", { index, transport }));
  }
  if (typeof value.server_name !== "string" || value.server_name.trim() === "") {
    throw new RuntimeMcpConfigError(configError("Runtime MCP server_name is required.", { index }));
  }
  if (typeof value.command !== "string" || value.command.trim() === "") {
    throw new RuntimeMcpConfigError(configError("Runtime MCP command is required.", { index, server_name: value.server_name }));
  }
  return {
    transport,
    server_name: normalizeMcpServerName(value.server_name),
    command: value.command,
    args: readStringArray(value.args, "args", index),
    cwd: readOptionalString(value.cwd, "cwd", index),
    env: readStringRecord(value.env, "env", index),
    required_env: readStringArray(value.required_env, "required_env", index),
    protocol_version: readOptionalString(value.protocol_version, "protocol_version", index),
    request_timeout_ms: readOptionalNumber(value.request_timeout_ms, "request_timeout_ms", index),
    refresh_interval_ms: readOptionalNumber(value.refresh_interval_ms, "refresh_interval_ms", index),
    enabled: typeof value.enabled === "boolean" ? value.enabled : undefined
  };
}

function normalizeMcpServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function readOptionalString(value: unknown, field: string, index: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new RuntimeMcpConfigError(configError("Runtime MCP config field must be a string.", { index, field }));
  }
  return value;
}

function readOptionalNumber(value: unknown, field: string, index: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RuntimeMcpConfigError(configError("Runtime MCP config field must be a positive number.", { index, field }));
  }
  return value;
}

function readStringArray(value: unknown, field: string, index: number): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new RuntimeMcpConfigError(configError("Runtime MCP config field must be a string array.", { index, field }));
  }
  return value;
}

function readStringRecord(value: unknown, field: string, index: number): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
    throw new RuntimeMcpConfigError(configError("Runtime MCP config field must be a string map.", { index, field }));
  }
  return value as Record<string, string>;
}

function configError(message: string, details: Record<string, unknown> = {}): ErrorObject {
  return {
    code: "CONFIGURATION_INVALID",
    message,
    retryable: false,
    severity: "error",
    details
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
