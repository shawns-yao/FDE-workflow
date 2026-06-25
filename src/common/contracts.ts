export const environments = ["dev", "test", "prod"] as const;
export type Environment = (typeof environments)[number];

export const errorSeverities = ["info", "warning", "error", "critical"] as const;
export type ErrorSeverity = (typeof errorSeverities)[number];

export const errorCodes = [
  "SCHEMA_VALIDATION_FAILED",
  "CONFIGURATION_INVALID",
  "UPSTREAM_UNAVAILABLE",
  "AUTHENTICATION_FAILED",
  "PERMISSION_DENIED",
  "IDEMPOTENCY_CONFLICT",
  "DELIVERY_RETRY_EXHAUSTED",
  "DLQ_PUBLISHED",
  "MODEL_NOT_CONFIGURED",
  "LLM_UNAVAILABLE",
  "TOOL_PERMISSION_DENIED",
  "ARTIFACT_WRITE_FAILED",
  "EVENT_PUBLISH_FAILED",
  "ARCHIVE_WRITE_FAILED",
  "COMMAND_EXECUTION_FAILED",
  "COMMAND_TIMEOUT"
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export interface ErrorObject {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  severity: ErrorSeverity;
  details?: Record<string, unknown>;
  cause_ref?: string;
}

export const artifactTypes = [
  "raw_event_payload",
  "normalized_event",
  "tool_trace",
  "agent_task_input",
  "agent_task_result",
  "diagnosis_context",
  "diagnosis_result",
  "notification_card",
  "yaml_audit_report",
  "code_review_report",
  "build_repair_report",
  "environment_check_report",
  "patch",
  "diff",
  "dead_letter_event",
  "delivery_attempt_log"
] as const;
export type ArtifactType = (typeof artifactTypes)[number];

export interface ArtifactRef {
  artifact_id?: string;
  artifact_uri: string;
  artifact_type: ArtifactType;
  content_type: string;
  sha256?: string;
  size_bytes?: number;
  created_at?: string;
  excerpt?: string;
}

export interface BaseMetadata {
  adapter_version?: string;
  upstream_system?: string;
  upstream_id?: string;
  namespace?: string;
  project_id?: string;
  repository?: string;
  branch?: string;
  commit_sha?: string;
  actor?: string;
  display_time?: string;
  pending_checks?: string[];
  [key: string]: unknown;
}

export interface BaseFields {
  correlation_id: string;
  trace_id: string;
  run_id: string;
  application: string;
  environment: Environment;
  created_at: string;
  metadata?: BaseMetadata;
}

export function createError(input: ErrorObject): ErrorObject {
  return input;
}
