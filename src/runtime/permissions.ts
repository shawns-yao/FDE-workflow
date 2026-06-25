import type { ErrorObject } from "../common/contracts.js";
import type { BaseTaskInput, BuiltinRuntimeToolName, PermissionProfileName, RuntimeToolName } from "./task-types.js";

export interface PermissionProfile {
  name: PermissionProfileName;
  tools: BuiltinRuntimeToolName[];
  command_allowlist?: string[];
  mcp_server_allowlist?: string[];
  mcp_tool_allowlist?: RuntimeToolName[];
}

export const permissionProfiles: Record<PermissionProfileName, PermissionProfile> = {
  "ci-readonly": {
    name: "ci-readonly",
    tools: ["read_file", "list_files", "run_command", "read_artifact", "write_artifact", "validate_schema"],
    command_allowlist: ["rg", "git diff", "git show", "git status"],
    mcp_server_allowlist: ["gitlab", "tekton", "argocd", "kubernetes"]
  },
  "ci-yaml-edit": {
    name: "ci-yaml-edit",
    tools: ["read_file", "edit_file", "write_file", "list_files", "run_command", "create_patch", "read_artifact", "write_artifact", "validate_schema"],
    command_allowlist: ["rg", "git diff", "git show", "git status", "yq", "kustomize build"],
    mcp_server_allowlist: ["gitlab", "tekton", "argocd", "kubernetes"]
  },
  "diagnosis-readonly": {
    name: "diagnosis-readonly",
    tools: ["read_artifact", "write_artifact", "summarize_log", "reason_about_failure", "validate_schema", "redact_sensitive_fields"],
    mcp_server_allowlist: ["gitlab", "tekton", "argocd", "kubernetes"]
  },
  "collaboration-notify": {
    name: "collaboration-notify",
    tools: ["read_artifact", "write_artifact", "classify_reply", "draft_notification", "validate_schema", "redact_sensitive_fields"],
    mcp_server_allowlist: ["feishu", "gitlab"]
  }
};

export interface PermissionCheckResult {
  allowed: boolean;
  blocked_tools: RuntimeToolName[];
  error?: ErrorObject;
}

export function checkTaskPermissions(input: BaseTaskInput): PermissionCheckResult {
  const profile = permissionProfiles[input.permission_profile];
  const blockedTools = input.allowed_tools.filter((tool) => !isToolAllowedByProfile(profile, tool));

  if (input.runtime_policy.environment === "prod") {
    for (const writeTool of ["write_file", "edit_file"] as RuntimeToolName[]) {
      if (input.allowed_tools.includes(writeTool)) {
        blockedTools.push(writeTool);
      }
    }
  }

  const uniqueBlockedTools = [...new Set(blockedTools)];
  if (uniqueBlockedTools.length === 0) {
    return { allowed: true, blocked_tools: [] };
  }

  return {
    allowed: false,
    blocked_tools: uniqueBlockedTools,
    error: {
      code: "TOOL_PERMISSION_DENIED",
      message: "Runtime 工具权限不满足 permission_profile 或环境策略",
      retryable: false,
      severity: "error",
      details: {
        permission_profile: input.permission_profile,
        blocked_tools: uniqueBlockedTools
      }
    }
  };
}

function isToolAllowedByProfile(profile: PermissionProfile, tool: RuntimeToolName): boolean {
  if (profile.tools.includes(tool as BuiltinRuntimeToolName)) {
    return true;
  }
  if (!tool.startsWith("mcp__")) {
    return false;
  }
  if (profile.mcp_tool_allowlist?.includes(tool)) {
    return true;
  }
  const serverName = tool.split("__")[1];
  return Boolean(serverName && profile.mcp_server_allowlist?.includes(serverName));
}

export function isCommandAllowed(
  profileName: PermissionProfileName,
  command: string
): boolean {
  const allowlist = permissionProfiles[profileName].command_allowlist;
  if (!allowlist) {
    return false;
  }

  const trimmed = command.trim();
  if (trimmed === "") return false;

  // 拒绝管道、重定向、命令连接符等危险操作
  if (/[|;&`$\\]/.test(trimmed)) {
    return false;
  }

  // 提取第一个 token 作为主程序
  const firstToken = trimmed.split(/\s+/)[0];

  // 拒绝绝对路径或相对路径命令
  if (firstToken.includes("/") || firstToken.includes("\\")) {
    return false;
  }

  // 精确匹配：只允许主程序在白名单中，且后续参数不改变命令本质
  return allowlist.some((allowedCommand) => {
    const allowedTokens = allowedCommand.split(/\s+/);
    const allowedProg = allowedTokens[0];

    // 主程序必须匹配
    if (firstToken !== allowedProg) {
      return false;
    }

    // 如果白名单命令带参数，整个命令必须以白名单为前缀
    // 例如白名单是 "git diff"，则 "git diff HEAD" 合法
    // 白名单是 "git"，则 "git diff HEAD" 合法
    if (allowedTokens.length === 1) {
      return true;
    }

    return trimmed === allowedCommand || trimmed.startsWith(`${allowedCommand} `);
  });
}
