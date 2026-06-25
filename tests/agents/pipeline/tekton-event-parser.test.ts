import test from "node:test";
import assert from "node:assert/strict";
import { parseTektonPipelineRunCompleted } from "../../../src/agents/pipeline/tekton-event-parser.js";
import type { CloudEvent } from "../../../src/events/cloudevent.js";
import type { TektonEventPayload } from "../../../src/agents/pipeline/types.js";

test("parses completed Tekton event into pipeline build payload", () => {
  const payload = parseTektonPipelineRunCompleted(
    tektonEvent({
      status: "Succeeded",
      results: [
        { name: "application", value: "api-gateway" },
        { name: "environment", value: "test" },
        { name: "image", value: "registry.example.com/team/api-gateway:5b24f0c212cfa1ba0eae5d497defb8d21879b0fc_1780371198" },
        { name: "build_log_uri", value: "artifacts/runs/corr-001/build.log" }
      ]
    })
  );

  assert.equal(payload.application, "api-gateway");
  assert.equal(payload.environment, "test");
  assert.equal(payload.image_name, "registry.example.com/team/api-gateway");
  assert.equal(payload.image_tag, "5b24f0c212cfa1ba0eae5d497defb8d21879b0fc_1780371198");
  assert.equal(payload.commit_sha, "5b24f0c212cfa1ba0eae5d497defb8d21879b0fc");
  assert.equal(payload.build_status, "succeeded");
  assert.equal(payload.trigger, "webhook");
});

test("represents failed Tekton status without using a separate failed event type", () => {
  const payload = parseTektonPipelineRunCompleted(
    tektonEvent({
      status: "Failed",
      results: [
        { name: "application", value: "api-gateway" },
        { name: "environment", value: "dev" },
        { name: "image_name", value: "registry.example.com/team/api-gateway" },
        { name: "image_tag", value: "bad-tag" },
        { name: "commit_sha", value: "abc123" }
      ]
    })
  );

  assert.equal(payload.build_status, "failed");
  assert.equal(payload.pipeline_run_id, "api-gateway-run-001");
  assert.equal(payload.build_id, "api-gateway-run-001");
});

function tektonEvent(data: Partial<TektonEventPayload>): CloudEvent<TektonEventPayload> {
  return {
    specversion: "1.0",
    id: "evt-001",
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
      ...data
    }
  };
}
