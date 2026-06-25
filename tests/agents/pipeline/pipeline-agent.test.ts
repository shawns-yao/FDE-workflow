import test from "node:test";
import assert from "node:assert/strict";
import { PipelineAgent } from "../../../src/agents/pipeline/pipeline-agent.js";
import { MemoryIdempotencyStore } from "../../../src/events/idempotency-store.js";
import type { EventBroker } from "../../../src/events/broker.js";
import type { CloudEvent } from "../../../src/events/cloudevent.js";
import type { ArgoSyncResult, PipelineAgentConfig, PipelinePreflightResult, TektonEventPayload, YamlUpdateResult } from "../../../src/agents/pipeline/types.js";
import type { AgentRuntime } from "../../../src/runtime/agent-runtime.js";
import type { BaseTaskInput, TaskResult } from "../../../src/runtime/task-types.js";

test("pipeline agent processes successful Tekton event through yaml update and git commit", async () => {
  const broker = new CaptureBroker();
  const git = new FakeGitOperations();
  const updater = new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] });
  const agent = new PipelineAgent({
    config: baseConfig,
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: git,
    yamlUpdater: updater
  });

  const result = await agent.handleTektonPipelineRunCompleted(tektonEvent("Succeeded"));

  assert.equal(result.status, "succeeded");
  assert.equal(git.ensureCalled, true);
  assert.equal(git.commitCalled, true);
  assert.deepEqual(
    broker.events.map((event) => event.type),
    ["gitops.yaml.updated", "pipeline.build.completed"]
  );
});

test("pipeline agent does not call runtime hooks by default", async () => {
  const runtime = new CaptureRuntime();
  const agent = new PipelineAgent({
    config: baseConfig,
    broker: new CaptureBroker(),
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: new FakeGitOperations(),
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] }),
    runtime
  });

  await agent.handleTektonPipelineRunCompleted(tektonEvent("Succeeded"));

  assert.equal(runtime.calls.length, 0);
});

test("pipeline agent calls yaml governance runtime before git commit when enabled", async () => {
  const order: string[] = [];
  const runtime = new CaptureRuntime(order);
  const git = new FakeGitOperations(order);
  const broker = new CaptureBroker();
  const agent = new PipelineAgent({
    config: {
      ...baseConfig,
      enable_yaml_governance: true,
      runtime_model: "runtime-model"
    },
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: git,
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] }, order),
    runtime
  });

  const result = await agent.handleTektonPipelineRunCompleted(tektonEvent("Succeeded"));

  assert.equal(result.status, "succeeded");
  assert.deepEqual(order, ["ensureRepository", "updateImage", "runCodeTask", "commitAndPush"]);
  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.calls[0].method, "runCodeTask");
  assert.equal(runtime.calls[0].input.agent_type, "pipeline");
  assert.equal(runtime.calls[0].input.business_task_type, "yaml_governance");
  assert.equal(runtime.calls[0].input.runtime_capability, "code_task");
  assert.equal(runtime.calls[0].input.permission_profile, "ci-yaml-edit");
  assert.equal(runtime.calls[0].input.workspace_ref, "C:/work/gitops-config");
  assert.equal(runtime.calls[0].input.model, "runtime-model");
  assert.deepEqual(runtime.calls[0].input.allowed_tools, ["read_file", "list_files"]);
  const completedEvent = broker.events.find((event) => event.type === "pipeline.build.completed");
  assert.equal((completedEvent?.data as { yaml_governance_result?: TaskResult }).yaml_governance_result?.status, "succeeded");
});

test("pipeline agent blocks git commit when yaml governance rejects change", async () => {
  const order: string[] = [];
  const broker = new CaptureBroker();
  const git = new FakeGitOperations(order);
  const runtime = new CaptureRuntime(order, {
    approved: false,
    risk_level: "high"
  });
  const agent = new PipelineAgent({
    config: {
      ...baseConfig,
      enable_yaml_governance: true
    },
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: git,
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] }, order),
    runtime
  });

  const result = await agent.handleTektonPipelineRunCompleted(tektonEvent("Succeeded"));

  assert.equal(result.status, "failed");
  assert.equal(git.commitCalled, false);
  assert.equal(git.discardCalled, true);
  assert.deepEqual(order, ["ensureRepository", "updateImage", "runCodeTask"]);
  assert.deepEqual(broker.events.map((event) => event.type), ["pipeline.deployment.failed"]);
});

test("pipeline agent publishes deployment failure for failed Tekton status", async () => {
  const broker = new CaptureBroker();
  const agent = new PipelineAgent({
    config: baseConfig,
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: new FakeGitOperations(),
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] })
  });

  const result = await agent.handleTektonPipelineRunCompleted(tektonEvent("Failed"));

  assert.equal(result.status, "failed");
  assert.deepEqual(broker.events.map((event) => event.type), ["pipeline.deployment.failed"]);
});

test("pipeline agent calls build fix runtime for failed Tekton status when enabled", async () => {
  const broker = new CaptureBroker();
  const runtime = new CaptureRuntime();
  const agent = new PipelineAgent({
    config: {
      ...baseConfig,
      enable_build_fix: true
    },
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: new FakeGitOperations(),
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] }),
    runtime
  });

  const result = await agent.handleTektonPipelineRunCompleted(tektonEvent("Failed"));

  assert.equal(result.status, "failed");
  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.calls[0].method, "runRepairTask");
  assert.equal(runtime.calls[0].input.business_task_type, "build_fix");
  assert.equal(runtime.calls[0].input.runtime_capability, "repair_task");
  assert.equal(runtime.calls[0].input.permission_profile, "ci-yaml-edit");
  assert.deepEqual(broker.events.map((event) => event.type), ["pipeline.deployment.failed"]);
});

test("pipeline agent keeps publishing failure when build fix runtime is enabled but missing", async () => {
  const broker = new CaptureBroker();
  const agent = new PipelineAgent({
    config: {
      ...baseConfig,
      enable_build_fix: true
    },
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: new FakeGitOperations(),
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] })
  });

  const result = await agent.handleTektonPipelineRunCompleted(tektonEvent("Failed"));

  assert.equal(result.status, "failed");
  assert.equal(result.build_fix_result?.status, "blocked");
  assert.equal(result.build_fix_result?.error?.code, "MODEL_NOT_CONFIGURED");
  assert.deepEqual(broker.events.map((event) => event.type), ["pipeline.deployment.failed"]);
});

test("pipeline agent blocks delivery when compliance preflight finds critical issues", async () => {
  const broker = new CaptureBroker();
  const git = new FakeGitOperations();
  const agent = new PipelineAgent({
    config: {
      ...baseConfig,
      enable_compliance_preflight: true
    },
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: git,
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] }),
    preflightChecker: new FakePreflightChecker({
      status: "blocked",
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "critical dependency issue",
        retryable: true,
        severity: "critical"
      }
    })
  });

  const result = await agent.handleTektonPipelineRunCompleted(tektonEvent("Succeeded"));

  assert.equal(result.status, "failed");
  assert.equal(result.preflight_result?.status, "blocked");
  assert.equal(git.ensureCalled, false);
  assert.deepEqual(broker.events.map((event) => event.type), ["pipeline.deployment.failed"]);
});

test("pipeline agent continues delivery when compliance preflight passes", async () => {
  const broker = new CaptureBroker();
  const git = new FakeGitOperations();
  const agent = new PipelineAgent({
    config: {
      ...baseConfig,
      enable_compliance_preflight: true
    },
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: git,
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] }),
    preflightChecker: new FakePreflightChecker({ status: "passed" })
  });

  const result = await agent.handleTektonPipelineRunCompleted(tektonEvent("Succeeded"));

  assert.equal(result.status, "succeeded");
  assert.equal(result.preflight_result?.status, "passed");
  assert.equal(git.ensureCalled, true);
  assert.deepEqual(
    broker.events.map((event) => event.type),
    ["gitops.yaml.updated", "pipeline.build.completed"]
  );
});

test("pipeline agent triggers ArgoCD sync after gitops update when enabled", async () => {
  const broker = new CaptureBroker();
  const order: string[] = [];
  const agent = new PipelineAgent({
    config: {
      ...baseConfig,
      enable_argocd_sync: true
    },
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: new FakeGitOperations(order),
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] }, order),
    argoCdSyncController: new FakeArgoCdSyncController({
      sync_status: "triggered",
      argocd_application: "api-gateway-dev",
      operation_id: "op-001"
    }, order)
  });

  const result = await agent.handleTektonPipelineRunCompleted(tektonEvent("Succeeded"));

  assert.equal(result.status, "succeeded");
  assert.equal(result.argo_sync_result?.sync_status, "triggered");
  assert.deepEqual(order, ["ensureRepository", "updateImage", "commitAndPush", "sync"]);
  assert.deepEqual(
    broker.events.map((event) => event.type),
    ["gitops.yaml.updated", "argocd.application.sync.requested", "pipeline.build.completed"]
  );
});

test("pipeline agent publishes deployment failure when ArgoCD sync request fails", async () => {
  const broker = new CaptureBroker();
  const agent = new PipelineAgent({
    config: {
      ...baseConfig,
      enable_argocd_sync: true
    },
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: new FakeGitOperations(),
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] }),
    argoCdSyncController: new FakeArgoCdSyncController({
      sync_status: "failed",
      argocd_application: "api-gateway-dev",
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "ArgoCD unavailable",
        retryable: true,
        severity: "error"
      }
    })
  });

  const result = await agent.handleTektonPipelineRunCompleted(tektonEvent("Succeeded"));

  assert.equal(result.status, "failed");
  assert.deepEqual(
    broker.events.map((event) => event.type),
    ["gitops.yaml.updated", "argocd.application.sync.requested", "pipeline.deployment.failed"]
  );
});

class CaptureBroker implements EventBroker {
  readonly events: CloudEvent[] = [];

  async publish<TData>(event: CloudEvent<TData>): Promise<void> {
    this.events.push(event);
  }

  async publishDeadLetter(): Promise<void> {}

  async subscribe(): Promise<void> {}
}

class FakeGitOperations {
  ensureCalled = false;
  commitCalled = false;
  discardCalled = false;

  constructor(private readonly order?: string[]) {}

  async ensureRepository(): Promise<string> {
    this.order?.push("ensureRepository");
    this.ensureCalled = true;
    return "C:/work/gitops-config";
  }

  async commitAndPush(): Promise<{ success: boolean; commitSha?: string; error?: string }> {
    this.order?.push("commitAndPush");
    this.commitCalled = true;
    return { success: true, commitSha: "abc123" };
  }

  async discardChanges(): Promise<void> {
    this.discardCalled = true;
  }
}

class FakeYamlUpdater {
  constructor(private readonly result: YamlUpdateResult, private readonly order?: string[]) {}

  async updateImage(): Promise<YamlUpdateResult> {
    this.order?.push("updateImage");
    return this.result;
  }
}

class FakePreflightChecker {
  constructor(private readonly result: PipelinePreflightResult) {}

  async check(): Promise<PipelinePreflightResult> {
    return this.result;
  }
}

class FakeArgoCdSyncController {
  constructor(private readonly result: ArgoSyncResult, private readonly order?: string[]) {}

  async sync(): Promise<ArgoSyncResult> {
    this.order?.push("sync");
    return this.result;
  }
}

class CaptureRuntime implements AgentRuntime {
  readonly calls: Array<{ method: keyof AgentRuntime; input: BaseTaskInput }> = [];

  constructor(private readonly order?: string[], private readonly structuredData: Record<string, unknown> = {
    approved: true,
    risk_level: "low"
  }) {}

  async runCodeTask(input: BaseTaskInput): Promise<TaskResult> {
    this.order?.push("runCodeTask");
    this.calls.push({ method: "runCodeTask", input });
    return runtimeResult(input, this.structuredData);
  }

  async runAnalysisTask(input: BaseTaskInput): Promise<TaskResult> {
    this.calls.push({ method: "runAnalysisTask", input });
    return runtimeResult(input, this.structuredData);
  }

  async runRepairTask(input: BaseTaskInput): Promise<TaskResult> {
    this.order?.push("runRepairTask");
    this.calls.push({ method: "runRepairTask", input });
    return runtimeResult(input, this.structuredData);
  }
}

function runtimeResult(input: BaseTaskInput, structuredData: Record<string, unknown> = {
  approved: true,
  risk_level: "low"
}): TaskResult {
  return {
    task_id: input.task_id,
    status: "succeeded",
    output: "{}",
    structured_data: structuredData,
    artifact_refs: [],
    token_usage: {
      input_tokens: 1,
      output_tokens: 1
    },
    permission_audit: {
      profile: input.permission_profile,
      blocked_tools: []
    }
  };
}

function tektonEvent(status: TektonEventPayload["status"]): CloudEvent<TektonEventPayload> {
  return {
    specversion: "1.0",
    id: `evt-${status}`,
    source: "tekton",
    type: "tekton.pipelinerun.completed",
    subject: "tekton/api-gateway-run-001",
    time: "2026-06-18T00:00:00.000Z",
    datacontenttype: "application/json",
    correlation_id: "corr-001",
    trace_id: "trace-001",
    run_id: "run-001",
    application: "api-gateway",
    environment: "dev",
    data: {
      pipelineRunName: "api-gateway-run-001",
      pipelineRunNamespace: "tekton-pipelines",
      status,
      startTime: "2026-06-18T00:00:00.000Z",
      results: [
        { name: "application", value: "api-gateway" },
        { name: "environment", value: "dev" },
        { name: "image", value: "registry.example.com/team/api-gateway:5b24f0c212cfa1ba0eae5d497defb8d21879b0fc_1780371198" }
      ]
    }
  };
}

const baseConfig: PipelineAgentConfig = {
  gitops_repo_url: "https://gitlab.example.com/group/config.git",
  gitops_repo_branch: "main",
  image_field_path: "spec.template.spec.containers[0].image",
  yaml_file_name: "{environment}.yaml",
  git_user_name: "fde-pipeline-bot",
  git_user_email: "fde-pipeline-bot@example.com",
  working_directory: "C:/work",
  max_retries: 3,
  retry_delay_ms: 1000
};
