import { defaultPipelineConfig } from "./types.js";

// 环境变量前缀
const ENV_PREFIX = "FDE_PIPELINE_";

// 从环境变量加载配置
export function loadPipelineConfig(): typeof defaultPipelineConfig {
  return {
    gitops_repo_url:
      process.env[`${ENV_PREFIX}GITOPS_REPO_URL`] ??
      defaultPipelineConfig.gitops_repo_url,
    gitops_repo_branch:
      process.env[`${ENV_PREFIX}GITOPS_REPO_BRANCH`] ??
      defaultPipelineConfig.gitops_repo_branch,
    gitops_repo_token: process.env[`${ENV_PREFIX}GITOPS_REPO_TOKEN`],
    image_field_path:
      process.env[`${ENV_PREFIX}IMAGE_FIELD_PATH`] ??
      defaultPipelineConfig.image_field_path,
    yaml_file_name:
      process.env[`${ENV_PREFIX}YAML_FILE_NAME`] ??
      defaultPipelineConfig.yaml_file_name,
    argocd_api_url: process.env[`${ENV_PREFIX}ARGOCD_API_URL`],
    argocd_token: process.env[`${ENV_PREFIX}ARGOCD_TOKEN`],
    webhook_token: process.env[`${ENV_PREFIX}WEBHOOK_TOKEN`],
    git_user_name:
      process.env[`${ENV_PREFIX}GIT_USER_NAME`] ??
      defaultPipelineConfig.git_user_name,
    git_user_email:
      process.env[`${ENV_PREFIX}GIT_USER_EMAIL`] ??
      defaultPipelineConfig.git_user_email,
    working_directory:
      process.env[`${ENV_PREFIX}WORKING_DIRECTORY`] ??
      defaultPipelineConfig.working_directory,
    max_retries:
      Number(process.env[`${ENV_PREFIX}MAX_RETRIES`]) ||
      defaultPipelineConfig.max_retries,
    retry_delay_ms:
      Number(process.env[`${ENV_PREFIX}RETRY_DELAY_MS`]) ||
      defaultPipelineConfig.retry_delay_ms,
    enable_compliance_preflight:
      process.env[`${ENV_PREFIX}ENABLE_COMPLIANCE_PREFLIGHT`] === "true",
    enable_argocd_sync:
      process.env[`${ENV_PREFIX}ENABLE_ARGOCD_SYNC`] === "true",
    enable_yaml_governance:
      process.env[`${ENV_PREFIX}ENABLE_YAML_GOVERNANCE`] === "true",
    enable_build_fix:
      process.env[`${ENV_PREFIX}ENABLE_BUILD_FIX`] === "true",
    runtime_model:
      process.env[`${ENV_PREFIX}RUNTIME_MODEL`] ??
      defaultPipelineConfig.runtime_model,
    yaml_governance_prompt_ref:
      process.env[`${ENV_PREFIX}YAML_GOVERNANCE_PROMPT_REF`] ??
      defaultPipelineConfig.yaml_governance_prompt_ref,
    yaml_governance_schema_ref:
      process.env[`${ENV_PREFIX}YAML_GOVERNANCE_SCHEMA_REF`] ??
      defaultPipelineConfig.yaml_governance_schema_ref,
    build_fix_prompt_ref:
      process.env[`${ENV_PREFIX}BUILD_FIX_PROMPT_REF`] ??
      defaultPipelineConfig.build_fix_prompt_ref,
    build_fix_schema_ref:
      process.env[`${ENV_PREFIX}BUILD_FIX_SCHEMA_REF`] ??
      defaultPipelineConfig.build_fix_schema_ref,
  };
}

// 校验配置完整性
export function validatePipelineConfig(
  config: ReturnType<typeof loadPipelineConfig>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.gitops_repo_url || config.gitops_repo_url.startsWith("TODO:")) {
    errors.push("GITOPS_REPO_URL is required and must be configured");
  }

  if (
    !config.image_field_path ||
    config.image_field_path.startsWith("TODO:")
  ) {
    errors.push("IMAGE_FIELD_PATH is required and must be configured");
  }

  if (!config.gitops_repo_branch) {
    errors.push("GITOPS_REPO_BRANCH is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
