import { isAbsolute, resolve } from "node:path";
import type { ErrorObject } from "../../../common/contracts.js";

export function resolveWorkspacePath(workspaceRef: string | undefined, requestedPath: string): { path?: string; error?: ErrorObject } {
  if (!workspaceRef) {
    return {
      error: permissionError("workspace_ref is required for workspace tools.")
    };
  }
  if (isAbsolute(requestedPath)) {
    return {
      error: permissionError("Workspace tool path must be relative.")
    };
  }
  const workspaceRoot = resolve(workspaceRef);
  const resolvedPath = resolve(workspaceRoot, requestedPath);
  if (resolvedPath !== workspaceRoot && !resolvedPath.startsWith(`${workspaceRoot}\\`) && !resolvedPath.startsWith(`${workspaceRoot}/`)) {
    return {
      error: permissionError("Workspace tool path escapes workspace_ref.")
    };
  }
  return { path: resolvedPath };
}

function permissionError(message: string): ErrorObject {
  return {
    code: "TOOL_PERMISSION_DENIED",
    message,
    retryable: false,
    severity: "error",
    details: {}
  };
}
