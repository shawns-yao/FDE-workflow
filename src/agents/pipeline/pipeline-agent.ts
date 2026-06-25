import type { EventBroker } from "../../events/broker.js";
import type { CloudEvent } from "../../events/cloudevent.js";
import type { EventType } from "../../events/event-types.js";
import type { IdempotencyStore } from "../../events/idempotency-store.js";
import type { AgentRuntime } from "../../runtime/agent-runtime.js";
import type { BaseTaskInput, TaskResult } from "../../runtime/task-types.js";
import { NoopArgoCdSyncController, type ArgoCdSyncController } from "./argocd-sync-controller.js";
import { NoopPipelinePreflightChecker, type PipelinePreflightChecker } from "./compliance-preflight.js";
import { GitOperations } from "./git-operations.js";
import { GitOpsYamlUpdater } from "./gitops-yaml-updater.js";
import { parseTektonPipelineRunCompleted } from "./tekton-event-parser.js";
import type { ArgoSyncResult, BuildCompletedPayload, PipelineAgentConfig, PipelinePreflightResult, TektonEventPayload, YamlUpdateResult } from "./types.js";

export interface PipelineAgentDependencies {
  config: PipelineAgentConfig;
  broker: EventBroker;
  idempotencyStore: IdempotencyStore;
  gitOperations?: Pick<GitOperations, "ensureRepository" | "commitAndPush" | "discardChanges">;
  yamlUpdater?: Pick<GitOpsYamlUpdater, "updateImage">;
  preflightChecker?: PipelinePreflightChecker;
  argoCdSyncController?: ArgoCdSyncController;
  runtime?: AgentRuntime;
}

export interface PipelineAgentResult {
  status: "succeeded" | "failed" | "skipped";
  build?: BuildCompletedPayload;
  preflight_result?: PipelinePreflightResult;
  yaml_update_result?: YamlUpdateResult;
  yaml_governance_result?: TaskResult;
  build_fix_result?: TaskResult;
  argo_sync_result?: ArgoSyncResult;
  reason?: string;
}

export class PipelineAgent {
  private readonly gitOperations: Pick<GitOperations, "ensureRepository" | "commitAndPush" | "discardChanges">;
  private readonly yamlUpdater: Pick<GitOpsYamlUpdater, "updateImage">;
  private readonly preflightChecker: PipelinePreflightChecker;
  private readonly argoCdSyncController: ArgoCdSyncController;

  constructor(private readonly dependencies: PipelineAgentDependencies) {
    this.gitOperations = dependencies.gitOperations ?? new GitOperations(dependencies.config);
    this.yamlUpdater = dependencies.yamlUpdater ?? new GitOpsYamlUpdater(dependencies.config);
    this.preflightChecker = dependencies.preflightChecker ?? new NoopPipelinePreflightChecker();
    this.argoCdSyncController = dependencies.argoCdSyncController ?? new NoopArgoCdSyncController();
  }

  async handleTektonPipelineRunCompleted(event: CloudEvent<TektonEventPayload>): Promise<PipelineAgentResult> {
    const build = parseTektonPipelineRunCompleted(event);
    const idempotencyKey = `pipeline:${build.build_id}:${build.environment}`;
    const previousState = await this.dependencies.idempotencyStore.get(idempotencyKey);
    if (previousState === "processed" || previousState === "processing") {
      return {
        status: "skipped",
        build,
        reason: "duplicate build event"
      };
    }

    await this.dependencies.idempotencyStore.set(idempotencyKey, "processing", 3600);

    if (build.build_status === "failed") {
      const buildFixResult = await this.runBuildFixIfEnabled(event, build);
      await this.publishDerivedEvent(event, "pipeline.deployment.failed", build, {
        reason: "tekton pipeline failed",
        build_fix_result: buildFixResult
      });
      await this.dependencies.idempotencyStore.set(idempotencyKey, "failed", 3600);
      return {
        status: "failed",
        build,
        build_fix_result: buildFixResult,
        reason: "tekton pipeline failed"
      };
    }

    try {
      const preflightResult = await this.runPreflightIfEnabled(event, build);
      if (preflightResult?.status === "blocked") {
        await this.publishDerivedEvent(event, "pipeline.deployment.failed", build, {
          reason: preflightResult.error?.message ?? "compliance preflight blocked pipeline",
          preflight_result: preflightResult
        });
        await this.dependencies.idempotencyStore.set(idempotencyKey, "failed", 3600);
        return {
          status: "failed",
          build,
          preflight_result: preflightResult,
          reason: preflightResult.error?.message ?? "compliance preflight blocked pipeline"
        };
      }

      const repoDir = await this.gitOperations.ensureRepository(
        this.dependencies.config.gitops_repo_url,
        this.dependencies.config.gitops_repo_branch,
        this.dependencies.config.working_directory
      );
      let changedFiles: string[] = [];
      const yamlResult = await this.yamlUpdater.updateImage({
        repoDir,
        application: build.application,
        environment: build.environment,
        image_name: build.image_name,
        image_tag: build.image_tag,
        build_id: build.build_id,
        run_id: event.run_id
      });
      changedFiles = yamlResult.changed_files;

      if (yamlResult.status === "error") {
        throw new Error(yamlResult.error?.message ?? "YAML update failed");
      }

      const yamlGovernanceResult = await this.runYamlGovernanceIfEnabled(event, build, repoDir, yamlResult);
      if (yamlGovernanceResult && yamlGovernanceResult.status !== "succeeded") {
        await this.gitOperations.discardChanges(repoDir, changedFiles);
        throw new Error(yamlGovernanceResult.error?.message ?? "YAML governance failed");
      }
      const governanceBlockReason = yamlGovernanceResult ? getYamlGovernanceBlockReason(yamlGovernanceResult) : undefined;
      if (governanceBlockReason) {
        await this.gitOperations.discardChanges(repoDir, changedFiles);
        throw new Error(governanceBlockReason);
      }

      if (yamlResult.status === "changed") {
        const commit = await this.gitOperations.commitAndPush(
          this.dependencies.config.gitops_repo_branch,
          repoDir,
          yamlResult.changed_files,
          yamlResult.commit_message ?? `chore(deploy): update ${build.application} image to ${build.image_tag}`
        );
        if (!commit.success) {
          throw new Error(commit.error ?? "Git commit and push failed");
        }
      }

      await this.publishDerivedEvent(event, "gitops.yaml.updated", build, yamlResult);

      const argoSyncResult = await this.runArgoCdSyncIfEnabled(build);
      if (argoSyncResult) {
        await this.publishDerivedEvent(event, "argocd.application.sync.requested", build, argoSyncResult);
        if (argoSyncResult.sync_status === "failed") {
          throw new Error(argoSyncResult.error?.message ?? "ArgoCD sync request failed");
        }
      }

      await this.publishDerivedEvent(event, "pipeline.build.completed", build, {
        preflight_result: preflightResult,
        yaml_update_result: yamlResult,
        yaml_governance_result: yamlGovernanceResult,
        argo_sync_result: argoSyncResult
      });
      await this.dependencies.idempotencyStore.set(idempotencyKey, "processed", 86400);

      return {
        status: "succeeded",
        build,
        preflight_result: preflightResult,
        yaml_update_result: yamlResult,
        yaml_governance_result: yamlGovernanceResult,
        argo_sync_result: argoSyncResult
      };
    } catch (error) {
      await this.publishDerivedEvent(event, "pipeline.deployment.failed", build, {
        reason: error instanceof Error ? error.message : String(error)
      });
      await this.dependencies.idempotencyStore.set(idempotencyKey, "failed", 3600);
      return {
        status: "failed",
        build,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async publishDerivedEvent<TData>(
    baseEvent: CloudEvent<TektonEventPayload>,
    type: EventType,
    build: BuildCompletedPayload,
    data: TData
  ): Promise<void> {
    await this.dependencies.broker.publish({
      specversion: "1.0",
      id: `${baseEvent.id}:${type}`,
      source: this.getDerivedEventSource(type),
      type,
      subject: `${build.application}/${build.environment}/${build.build_id}`,
      time: new Date().toISOString(),
      datacontenttype: "application/json",
      correlation_id: baseEvent.correlation_id,
      trace_id: baseEvent.trace_id,
      run_id: baseEvent.run_id,
      application: build.application,
      environment: build.environment,
      data
    });
  }

  private getDerivedEventSource(type: EventType): CloudEvent["source"] {
    if (type.startsWith("gitops.")) {
      return "gitops";
    }
    if (type.startsWith("argocd.")) {
      return "argocd";
    }
    return "pipeline";
  }

  private async runPreflightIfEnabled(
    event: CloudEvent<TektonEventPayload>,
    build: BuildCompletedPayload
  ): Promise<PipelinePreflightResult | undefined> {
    if (!this.dependencies.config.enable_compliance_preflight) {
      return undefined;
    }
    return await this.preflightChecker.check({
      build,
      correlation_id: event.correlation_id,
      trace_id: event.trace_id,
      run_id: event.run_id
    });
  }

  private async runArgoCdSyncIfEnabled(build: BuildCompletedPayload): Promise<ArgoSyncResult | undefined> {
    if (!this.dependencies.config.enable_argocd_sync) {
      return undefined;
    }
    return await this.argoCdSyncController.sync({ build });
  }

  private async runYamlGovernanceIfEnabled(
    event: CloudEvent<TektonEventPayload>,
    build: BuildCompletedPayload,
    repoDir: string,
    yamlResult: YamlUpdateResult
  ): Promise<TaskResult | undefined> {
    if (!this.dependencies.config.enable_yaml_governance) {
      return undefined;
    }
    if (!this.dependencies.runtime) {
      return this.runtimeNotConfiguredTask(event, build, "yaml-governance", "yaml_governance", "code_task");
    }
    return await this.dependencies.runtime.runCodeTask(
      this.createRuntimeTask(event, build, {
        taskSuffix: "yaml-governance",
        businessTaskType: "yaml_governance",
        runtimeCapability: "code_task",
        permissionProfile: "ci-yaml-edit",
        promptRef: this.dependencies.config.yaml_governance_prompt_ref ?? "prompts/pipeline/yaml-governance.md",
        schemaRef: this.dependencies.config.yaml_governance_schema_ref ?? "schemas/agent-runtime/agent-task-result.schema.json",
        workspaceRef: repoDir,
        contextRefs: [
          `pipeline-build:${build.build_id}`,
          `gitops-repo:${repoDir}`,
          `yaml-result:${yamlResult.status}`
        ],
        artifactRefs: yamlResult.diff_artifact_uri ? [
          {
            artifact_uri: yamlResult.diff_artifact_uri,
            artifact_type: "diff",
            content_type: "text/plain"
          }
        ] : [],
        allowedTools: ["read_file", "list_files"]
      })
    );
  }

  private async runBuildFixIfEnabled(
    event: CloudEvent<TektonEventPayload>,
    build: BuildCompletedPayload
  ): Promise<TaskResult | undefined> {
    if (!this.dependencies.config.enable_build_fix) {
      return undefined;
    }
    if (!this.dependencies.runtime) {
      return this.runtimeNotConfiguredTask(event, build, "build-fix", "build_fix", "repair_task");
    }
    return await this.dependencies.runtime.runRepairTask(
      this.createRuntimeTask(event, build, {
        taskSuffix: "build-fix",
        businessTaskType: "build_fix",
        runtimeCapability: "repair_task",
        permissionProfile: event.environment === "prod" ? "ci-readonly" : "ci-yaml-edit",
        promptRef: this.dependencies.config.build_fix_prompt_ref ?? "prompts/pipeline/build-fix.md",
        schemaRef: this.dependencies.config.build_fix_schema_ref ?? "schemas/agent-runtime/agent-task-result.schema.json",
        contextRefs: [
          `pipeline-build:${build.build_id}`,
          `build-log:${build.build_log_uri ?? "missing"}`
        ],
        allowedTools: event.environment === "prod"
          ? ["read_file", "list_files", "run_command", "read_artifact", "write_artifact", "validate_schema"]
          : ["read_file", "edit_file", "write_file", "list_files", "run_command", "create_patch", "read_artifact", "write_artifact", "validate_schema"]
      })
    );
  }

  private createRuntimeTask(
    event: CloudEvent<TektonEventPayload>,
    build: BuildCompletedPayload,
    input: {
      taskSuffix: string;
      businessTaskType: BaseTaskInput["business_task_type"];
      runtimeCapability: BaseTaskInput["runtime_capability"];
      permissionProfile: BaseTaskInput["permission_profile"];
      promptRef: string;
      schemaRef: string;
      contextRefs: string[];
      artifactRefs?: BaseTaskInput["artifact_refs"];
      allowedTools: BaseTaskInput["allowed_tools"];
      workspaceRef?: string;
    }
  ): BaseTaskInput {
    return {
      task_id: `${build.build_id}:${input.taskSuffix}`,
      agent_type: "pipeline",
      business_task_type: input.businessTaskType,
      runtime_capability: input.runtimeCapability,
      runtime_type: "code_runtime",
      workspace_ref: input.workspaceRef,
      context_refs: input.contextRefs,
      artifact_refs: input.artifactRefs ?? [],
      prompt_ref: input.promptRef,
      schema_ref: input.schemaRef,
      permission_profile: input.permissionProfile,
      runtime_policy: {
        environment: build.environment,
        timeout_ms: 120000,
        max_tool_calls: 16,
        max_tokens: 8000,
        retry_count: 1
      },
      allowed_tools: input.allowedTools,
      model: this.dependencies.config.runtime_model ?? "configured-model",
      output_format: "json",
      correlation_id: event.correlation_id,
      trace_id: event.trace_id,
      run_id: event.run_id
    };
  }

  private runtimeNotConfiguredTask(
    event: CloudEvent<TektonEventPayload>,
    build: BuildCompletedPayload,
    taskSuffix: string,
    businessTaskType: BaseTaskInput["business_task_type"],
    runtimeCapability: BaseTaskInput["runtime_capability"]
  ): TaskResult {
    return {
      task_id: `${build.build_id}:${taskSuffix}`,
      status: "blocked",
      output: "",
      artifact_refs: [],
      token_usage: {
        input_tokens: 0,
        output_tokens: 0
      },
      permission_audit: {
        profile: "",
        blocked_tools: []
      },
      error: {
        code: "MODEL_NOT_CONFIGURED",
        message: "Pipeline Agent Runtime is not configured.",
        retryable: false,
        severity: "warning",
        details: {
          agent_type: "pipeline",
          business_task_type: businessTaskType,
          runtime_capability: runtimeCapability,
          correlation_id: event.correlation_id
        }
      }
    };
  }
}

interface YamlGovernanceStructuredData {
  approved?: unknown;
  risk_level?: unknown;
}

function getYamlGovernanceBlockReason(result: TaskResult): string | undefined {
  const structuredData = result.structured_data as YamlGovernanceStructuredData | undefined;
  if (!structuredData || typeof structuredData !== "object") {
    return "YAML governance result missing structured_data.";
  }
  if (structuredData.approved !== true) {
    return "YAML governance rejected this change.";
  }
  if (structuredData.risk_level === "high" || structuredData.risk_level === "critical") {
    return "YAML governance detected high risk configuration.";
  }
  if (typeof structuredData.risk_level !== "string") {
    return "YAML governance result missing risk_level.";
  }
  return undefined;
}
