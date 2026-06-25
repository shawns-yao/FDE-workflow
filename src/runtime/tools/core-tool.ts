import type { ErrorObject } from "../../common/contracts.js";
import type { PermissionProfileName, RuntimeToolName } from "../task-types.js";

export interface CoreToolContext {
  workspace_ref?: string;
  permission_profile?: PermissionProfileName;
  allowed_tools?: RuntimeToolName[];
}

export type CoreToolResult =
  | {
      status: "succeeded";
      output: unknown;
    }
  | {
      status: "failed" | "blocked";
      error: ErrorObject;
    };

export interface CoreTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  source?: "builtin" | "mcp";
  source_name?: string;
  call(input: unknown, context: CoreToolContext): Promise<CoreToolResult>;
}

export interface ToolProviderContext {
  allowed_tools: RuntimeToolName[];
  permission_profile: PermissionProfileName;
}

export interface ToolProvider {
  name: string;
  source: "builtin" | "mcp";
  start?(): Promise<void>;
  stop?(): Promise<void>;
  refreshTools?(context: ToolProviderContext): Promise<CoreTool[]>;
  listTools(context: ToolProviderContext): Promise<CoreTool[]> | CoreTool[];
}
