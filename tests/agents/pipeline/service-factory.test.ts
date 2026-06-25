import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryEventArchiveRepository } from "../../../src/events/archive.js";
import { MemoryEventBroker } from "../../../src/events/memory-event-broker.js";
import { MemoryIdempotencyStore } from "../../../src/events/idempotency-store.js";
import { createPipelineAgentWorker, type PipelineEventInfrastructure } from "../../../src/agents/pipeline/service-factory.js";
import type { CloudEvent } from "../../../src/events/cloudevent.js";
import type { ArtifactStore, ArtifactWriteInput } from "../../../src/common/artifact-store.js";
import type { ArgoSyncResult, PipelineAgentConfig, PipelinePreflightResult, TektonEventPayload, YamlUpdateResult } from "../../../src/agents/pipeline/types.js";
import type { AnthropicMessagesClient } from "../../../src/runtime/adapters/anthropic/messages-client.js";

test("pipeline worker factory wires event infrastructure to pipeline consumer", async () => {
  const broker = new MemoryEventBroker();
  const infrastructure: PipelineEventInfrastructure = {
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    closeCalled: false,
    async close() {
      this.closeCalled = true;
    }
  } as PipelineEventInfrastructure & { closeCalled: boolean };
  const git = new FakeGitOperations();
  const worker = createPipelineAgentWorker({
    config: baseConfig,
    archiveRepository: new MemoryEventArchiveRepository(),
    createEventInfrastructure: () => infrastructure,
    gitOperations: git,
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] })
  });

  await worker.start();
  await broker.publish(tektonEvent());
  await worker.close();

  assert.equal(git.ensureCalled, true);
  assert.equal(git.commitCalled, true);
  assert.equal((infrastructure as PipelineEventInfrastructure & { closeCalled: boolean }).closeCalled, true);
});

test("pipeline worker factory wires optional preflight and argocd controllers", async () => {
  const broker = new MemoryEventBroker();
  const infrastructure: PipelineEventInfrastructure = {
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    async close() {}
  };
  const preflight = new FakePreflightChecker({ status: "passed" });
  const argo = new FakeArgoCdSyncController({
    sync_status: "triggered",
    argocd_application: "api-gateway-dev",
    operation_id: "op-001"
  });
  const worker = createPipelineAgentWorker({
    config: {
      ...baseConfig,
      enable_compliance_preflight: true,
      enable_argocd_sync: true
    },
    archiveRepository: new MemoryEventArchiveRepository(),
    createEventInfrastructure: () => infrastructure,
    gitOperations: new FakeGitOperations(),
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] }),
    preflightChecker: preflight,
    argoCdSyncController: argo
  });

  await worker.start();
  await broker.publish(tektonEvent());
  await worker.close();

  assert.equal(preflight.called, true);
  assert.equal(argo.called, true);
});

test("pipeline worker factory wires artifact store into default yaml updater", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "fde-pipeline-factory-"));
  try {
    await mkdir(join(repoDir, "api-gateway"), { recursive: true });
    await writeFile(
      join(repoDir, "api-gateway", "dev.yaml"),
      "spec:\n  template:\n    spec:\n      containers:\n        - image: registry.example.com/team/api-gateway:old-tag\n",
      "utf8"
    );
    const broker = new MemoryEventBroker();
    const artifactStore = new CaptureArtifactStore();
    const infrastructure: PipelineEventInfrastructure = {
      broker,
      idempotencyStore: new MemoryIdempotencyStore(),
      async close() {}
    };
    const worker = createPipelineAgentWorker({
      config: baseConfig,
      archiveRepository: new MemoryEventArchiveRepository(),
      createEventInfrastructure: () => infrastructure,
      artifactStore,
      gitOperations: new FakeGitOperations(repoDir)
    });

    await worker.start();
    await broker.publish(tektonEvent());
    await worker.close();

    assert.equal(artifactStore.writes.length, 1);
    assert.equal(artifactStore.writes[0].artifact_type, "diff");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("pipeline worker factory registers code_runtime repair executor when build fix is enabled", async () => {
  const broker = new MemoryEventBroker();
  const infrastructure: PipelineEventInfrastructure = {
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    async close() {}
  };
  const worker = createPipelineAgentWorker({
    config: {
      ...baseConfig,
      enable_build_fix: true,
      build_fix_schema_ref: "schemas/pipeline/yaml-governance-result.schema.json"
    },
    archiveRepository: new MemoryEventArchiveRepository(),
    createEventInfrastructure: () => infrastructure,
    artifactStore: new CaptureArtifactStore(),
    anthropicClient: new FakeAnthropicClient()
  });

  const result = await worker.agent.handleTektonPipelineRunCompleted(tektonEvent("Failed"));
  await worker.close();

  assert.equal(result.status, "failed");
  assert.equal(result.build_fix_result?.status, "succeeded");
  const structuredData = result.build_fix_result?.structured_data as { approved?: boolean } | undefined;
  assert.equal(structuredData?.approved, true);
});

class FakeGitOperations {
  ensureCalled = false;
  commitCalled = false;

  constructor(private readonly repoDir = "C:/work/gitops-config") {}

  async ensureRepository(): Promise<string> {
    this.ensureCalled = true;
    return this.repoDir;
  }

  async commitAndPush(): Promise<{ success: boolean; commitSha?: string; error?: string }> {
    this.commitCalled = true;
    return { success: true, commitSha: "abc123" };
  }

  async discardChanges(): Promise<void> {}
}

class FakeYamlUpdater {
  constructor(private readonly result: YamlUpdateResult) {}

  async updateImage(): Promise<YamlUpdateResult> {
    return this.result;
  }
}

class FakePreflightChecker {
  called = false;

  constructor(private readonly result: PipelinePreflightResult) {}

  async check(): Promise<PipelinePreflightResult> {
    this.called = true;
    return this.result;
  }
}

class FakeArgoCdSyncController {
  called = false;

  constructor(private readonly result: ArgoSyncResult) {}

  async sync(): Promise<ArgoSyncResult> {
    this.called = true;
    return this.result;
  }
}

class CaptureArtifactStore implements ArtifactStore {
  readonly writes: ArtifactWriteInput[] = [];

  async write(input: ArtifactWriteInput) {
    this.writes.push(input);
    return {
      artifact_uri: input.artifact_uri ?? "artifacts/runs/unscoped/diff.txt",
      artifact_type: input.artifact_type,
      content_type: input.content_type
    };
  }

  async read(): Promise<Buffer> {
    return Buffer.from("");
  }
}

class FakeAnthropicClient implements AnthropicMessagesClient {
  async createMessage() {
    return {
      text: JSON.stringify({
        approved: true,
        risk_level: "low",
        summary: "build fix advice generated",
        changed_files_reviewed: [],
        findings: [],
        required_fixes: [],
        auto_fixed: []
      }),
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            approved: true,
            risk_level: "low",
            summary: "build fix advice generated",
            changed_files_reviewed: [],
            findings: [],
            required_fixes: [],
            auto_fixed: []
          })
        }
      ],
      input_tokens: 1,
      output_tokens: 1,
      raw: {}
    };
  }
}

function tektonEvent(status: TektonEventPayload["status"] = "Succeeded"): CloudEvent<TektonEventPayload> {
  return {
    specversion: "1.0",
    id: "evt-pipeline-factory",
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
