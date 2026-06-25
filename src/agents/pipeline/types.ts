import type { Environment, ErrorObject } from "../../common/contracts.js";
import type { EnvironmentScanResult } from "../../radars/compliance/types.js";

// Pipeline 状态定义
export const pipelineStatuses = [
  "pending",
  "updating",
  "syncing",
  "success",
  "failed",
  "retrying"
] as const;
export type PipelineStatus = (typeof pipelineStatuses)[number];

// Pipeline 事件类型
export const pipelineEventTypes = [
  "pipeline.build.completed",
  "pipeline.deployment.failed",
  "gitops.yaml.updated"
] as const;
export type PipelineEventType = (typeof pipelineEventTypes)[number];

// 构建完成事件载荷
export interface BuildCompletedPayload {
  application: string;
  environment: Environment;
  image_name: string;
  image_tag: string;
  build_status: "succeeded" | "failed";
  build_log_uri?: string;
  commit_sha: string;
  pipeline_run_id: string;
  build_id: string;
  trigger: "manual" | "webhook" | "schedule";
}

// YAML 更新结果
export interface YamlUpdateResult {
  status: "changed" | "unchanged" | "error";
  config_repo: string;
  changed_files: string[];
  diff_artifact_uri?: string;
  commit_message?: string;
  error?: ErrorObject;
}

// ArgoCD 同步结果
export interface ArgoSyncResult {
  sync_status: "triggered" | "failed" | "skipped";
  argocd_application: string;
  operation_id?: string;
  error?: ErrorObject;
}

export interface PipelinePreflightResult {
  status: "passed" | "blocked" | "skipped";
  scan_result?: EnvironmentScanResult;
  error?: ErrorObject;
}

// Pipeline 任务定义
export interface PipelineTask {
  task_id: string;
  build_id: string;
  application: string;
  environment: Environment;
  image_name: string;
  image_tag: string;
  commit_sha: string;
  pipeline_run_id: string;
  status: PipelineStatus;
  created_at: string;
  updated_at: string;
  trigger: "manual" | "webhook" | "schedule";
  build_log_uri?: string;
  yaml_update_result?: YamlUpdateResult;
  argo_sync_result?: ArgoSyncResult;
  error?: ErrorObject;
}

// Pipeline Agent 配置
export interface PipelineAgentConfig {
  gitops_repo_url: string;
  gitops_repo_branch: string;
  gitops_repo_token?: string;
  image_field_path: string;
  yaml_file_name: string;
  argocd_api_url?: string;
  argocd_token?: string;
  webhook_token?: string;
  git_user_name: string;
  git_user_email: string;
  working_directory: string;
  max_retries: number;
  retry_delay_ms: number;
  enable_compliance_preflight?: boolean;
  enable_argocd_sync?: boolean;
  enable_yaml_governance?: boolean;
  enable_build_fix?: boolean;
  runtime_model?: string;
  yaml_governance_prompt_ref?: string;
  yaml_governance_schema_ref?: string;
  build_fix_prompt_ref?: string;
  build_fix_schema_ref?: string;
}

// Tekton 事件载荷 (简化版，用于M1)
export interface TektonEventPayload {
  pipelineRunName: string;
  pipelineRunNamespace: string;
  status: "Succeeded" | "Failed" | "Cancelled";
  startTime: string;
  completionTime?: string;
  results?: Array<{
    name: string;
    value: string;
  }>;
  params?: Record<string, string>;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

// 默认配置（使用占位符）
export const defaultPipelineConfig: PipelineAgentConfig = {
  gitops_repo_url: "TODO:GITOPS_REPO_URL",
  gitops_repo_branch: "main",
  image_field_path: "TODO:IMAGE_FIELD_PATH",
  yaml_file_name: "{environment}.yaml",
  git_user_name: "fde-pipeline-bot",
  git_user_email: "fde-pipeline-bot@example.com",
  working_directory: "./workspace",
  max_retries: 3,
  retry_delay_ms: 1000,
  enable_compliance_preflight: false,
  enable_argocd_sync: false,
  enable_yaml_governance: false,
  enable_build_fix: false,
  runtime_model: "configured-model",
  yaml_governance_prompt_ref: "prompts/pipeline/yaml-governance.md",
  yaml_governance_schema_ref: "schemas/pipeline/yaml-governance-result.schema.json",
  build_fix_prompt_ref: "prompts/pipeline/build-fix.md",
  build_fix_schema_ref: "schemas/agent-runtime/agent-task-result.schema.json",
};
