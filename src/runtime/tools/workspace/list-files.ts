import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { CoreTool, CoreToolContext, CoreToolResult } from "../core-tool.js";
import { resolveWorkspacePath } from "./path-policy.js";

export function createListFilesTool(): CoreTool {
  return {
    name: "list_files",
    description: "List files under a directory inside workspace_ref.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        max_depth: { type: "integer", minimum: 0 },
        max_files: { type: "integer", minimum: 1 }
      }
    },
    async call(input: unknown, context: CoreToolContext): Promise<CoreToolResult> {
      const record = isRecord(input) ? input : {};
      const requestedPath = typeof record.path === "string" ? record.path : ".";
      const resolved = resolveWorkspacePath(context.workspace_ref, requestedPath);
      if (resolved.error || !resolved.path || !context.workspace_ref) {
        return { status: "blocked", error: resolved.error! };
      }
      const maxDepth = typeof record.max_depth === "number" ? record.max_depth : 4;
      const maxFiles = typeof record.max_files === "number" ? record.max_files : 100;
      const files: string[] = [];
      await walk(context.workspace_ref, resolved.path, maxDepth, maxFiles, files);
      return {
        status: "succeeded",
        output: {
          path: requestedPath,
          files,
          truncated: files.length >= maxFiles
        }
      };
    }
  };
}

async function walk(root: string, dir: string, depth: number, maxFiles: number, output: string[]): Promise<void> {
  if (depth < 0 || output.length >= maxFiles) {
    return;
  }
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= maxFiles) {
      return;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, fullPath, depth - 1, maxFiles, output);
      continue;
    }
    if (entry.isFile()) {
      const info = await stat(fullPath);
      output.push(`${relative(root, fullPath).replaceAll("\\", "/")} (${info.size} bytes)`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
