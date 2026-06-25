import { readFile } from "node:fs/promises";
import type { CoreTool, CoreToolContext, CoreToolResult } from "../core-tool.js";
import { resolveWorkspacePath } from "./path-policy.js";

export function createReadFileTool(): CoreTool {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file inside workspace_ref.",
    input_schema: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        max_bytes: { type: "integer", minimum: 1 }
      }
    },
    async call(input: unknown, context: CoreToolContext): Promise<CoreToolResult> {
      if (!isRecord(input) || typeof input.path !== "string") {
        return {
          status: "failed",
          error: {
            code: "SCHEMA_VALIDATION_FAILED",
            message: "read_file requires a string path.",
            retryable: false,
            severity: "error"
          }
        };
      }
      const resolved = resolveWorkspacePath(context.workspace_ref, input.path);
      if (resolved.error || !resolved.path) {
        return { status: "blocked", error: resolved.error! };
      }
      const maxBytes = typeof input.max_bytes === "number" ? input.max_bytes : 50000;
      const content = await readFile(resolved.path, "utf8");
      return {
        status: "succeeded",
        output: {
          path: input.path,
          content: content.slice(0, maxBytes),
          truncated: content.length > maxBytes
        }
      };
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
