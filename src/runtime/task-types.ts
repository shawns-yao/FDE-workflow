import type { ArtifactRef, Environment, ErrorObject } from "../common/contracts.js";

export const businessTaskTypes = [
  "mr_review",
  "yaml_governance",
  "build_fix",
  "log_triage",
  "root_cause",
  "notification",
  "progress_tracking",
  "daily_report"
] as const;
export type BusinessTaskType = (typeof businessTaskTypes)[number];

export const runtimeCapabilities = ["code_task", "analysis_task", "repair_task"] as const;
export type RuntimeCapability = (typeof runtimeCapabilities)[number];

export const runtimeTypes = ["code_runtime", "claude_api"] as const;
export type RuntimeType = (typeof runtimeTypes)[number];

export const agentTypes = ["pipeline", "diagnosis", "collaboration"] as const;
export type AgentType = (typeof agentTypes)[number];

export const outputFormats = ["json", "text"] as const;
export type OutputFormat = (typeof outputFormats)[number];

export const taskStatuses = ["succeeded", "failed", "blocked", "timed_out"] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export interface RuntimePolicy {
  environment: Environment;
  timeout_ms: number;
  max_tool_calls: number;
  max_tokens: number;
  retry_count: number;
}

export interface BaseTaskInput {
  task_id: string;
  agent_type: AgentType;
  business_task_type: BusinessTaskType;
  runtime_capability: RuntimeCapability;
  runtime_type: RuntimeType;
  workspace_ref?: string;
  context_refs: string[];
  artifact_refs?: ArtifactRef[];
  prompt_ref: string;
  schema_ref: string;
  permission_profile: PermissionProfileName;
  runtime_policy: RuntimePolicy;
  allowed_tools: RuntimeToolName[];
  model: string;
  output_format: OutputFormat;
  correlation_id: string;
  trace_id: string;
  run_id: string;
}

export interface TaskResult {
  task_id: string;
  status: TaskStatus;
  output: string;
  structured_data?: unknown;
  artifact_refs: ArtifactRef[];
  patch_ref?: string;
  tool_trace_ref?: string;
  token_usage: {
    input_tokens: number;
    output_tokens: number;
  };
  permission_audit: {
    profile: string;
    blocked_tools: RuntimeToolName[];
  };
  error?: ErrorObject;
}

export const runtimeToolNames = [
  "read_file",
  "edit_file",
  "write_file",
  "list_files",
  "run_command",
  "git_diff",
  "git_show",
  "git_status",
  "read_artifact",
  "write_artifact",
  "create_patch",
  "attach_evidence",
  "summarize_log",
  "classify_reply",
  "draft_notification",
  "reason_about_failure",
  "validate_schema",
  "check_permission",
  "redact_sensitive_fields",
  "record_tool_trace"
] as const;
export type BuiltinRuntimeToolName = (typeof runtimeToolNames)[number];
export type McpRuntimeToolName = `mcp__${string}__${string}`;
export type RuntimeToolName = BuiltinRuntimeToolName | McpRuntimeToolName;

export const permissionProfileNames = ["ci-readonly", "ci-yaml-edit", "diagnosis-readonly", "collaboration-notify"] as const;
export type PermissionProfileName = (typeof permissionProfileNames)[number];
