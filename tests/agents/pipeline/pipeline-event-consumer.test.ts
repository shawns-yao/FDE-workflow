import test from "node:test";
import assert from "node:assert/strict";
import { MemoryEventArchiveRepository } from "../../../src/events/archive.js";
import { EventSubscriber } from "../../../src/events/event-subscriber.js";
import { MemoryEventBroker } from "../../../src/events/memory-event-broker.js";
import { MemoryIdempotencyStore } from "../../../src/events/idempotency-store.js";
import { PipelineEventConsumer } from "../../../src/agents/pipeline/pipeline-event-consumer.js";
import { PipelineAgent } from "../../../src/agents/pipeline/pipeline-agent.js";
import type { CloudEvent } from "../../../src/events/cloudevent.js";
import type { PipelineAgentConfig, TektonEventPayload, YamlUpdateResult } from "../../../src/agents/pipeline/types.js";

test("pipeline event consumer subscribes Tekton completed events and invokes pipeline agent", async () => {
  const broker = new MemoryEventBroker();
  const archive = new MemoryEventArchiveRepository();
  const subscriber = new EventSubscriber(broker, new MemoryIdempotencyStore(), archive);
  const git = new FakeGitOperations();
  const agent = new PipelineAgent({
    config: baseConfig,
    broker,
    idempotencyStore: new MemoryIdempotencyStore(),
    gitOperations: git,
    yamlUpdater: new FakeYamlUpdater({ status: "changed", config_repo: "repo", changed_files: ["api-gateway/dev.yaml"] })
  });
  const consumer = new PipelineEventConsumer(subscriber, agent);

  await consumer.start();
  await broker.publish(tektonEvent());

  assert.equal(git.ensureCalled, true);
  assert.equal(git.commitCalled, true);
  assert.equal(archive.deliveries.at(-1)?.consumer_id, "pipeline-agent");
  assert.equal(archive.deliveries.at(-1)?.queue_name, "agent.pipeline");
  assert.equal(archive.deliveries.at(-1)?.status, "processed");
});

class FakeGitOperations {
  ensureCalled = false;
  commitCalled = false;

  async ensureRepository(): Promise<string> {
    this.ensureCalled = true;
    return "C:/work/gitops-config";
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

function tektonEvent(): CloudEvent<TektonEventPayload> {
  return {
    specversion: "1.0",
    id: "evt-pipeline-consumer",
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
      status: "Succeeded",
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
