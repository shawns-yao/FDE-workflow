import test from "node:test";
import assert from "node:assert/strict";
import { MemoryEventArchiveRepository } from "../../src/events/archive.js";
import type { EventBroker } from "../../src/events/broker.js";
import type { CloudEvent } from "../../src/events/cloudevent.js";
import { EventIngressService } from "../../src/events/event-ingress-service.js";
import { EventPublisherService } from "../../src/events/event-publisher.js";

test("accepts a GitLab webhook after token verification and publishes a normalized event", async () => {
  const broker = new CapturingPublishBroker();
  const archive = new MemoryEventArchiveRepository();
  const ingress = new EventIngressService(new EventPublisherService(broker, archive), {
    gitlabToken: "expected"
  });

  const result = await ingress.handle({
    source: "gitlab",
    headers: { "x-gitlab-token": "expected" },
    environment: "dev",
    body: {
      project_id: 42,
      merge_request_iid: 7,
      project_name: "checkout",
      token: "must-redact"
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(result.event?.source, "gitlab");
  assert.equal(result.event?.type, "gitlab.mr.updated");
  assert.equal(result.publish_result?.published, true);
  assert.equal(broker.events.length, 1);
  assert.equal(archive.events.length, 1);
  assert.equal((broker.events[0].data as Record<string, unknown>).token, "[REDACTED]");
});

test("rejects a GitLab webhook before publishing when token verification fails", async () => {
  const broker = new CapturingPublishBroker();
  const ingress = new EventIngressService(new EventPublisherService(broker, new MemoryEventArchiveRepository()), {
    gitlabToken: "expected"
  });

  const result = await ingress.handle({
    source: "gitlab",
    headers: { "x-gitlab-token": "bad" },
    environment: "dev",
    body: {
      project_id: 42,
      merge_request_iid: 7
    }
  });

  assert.equal(result.accepted, false);
  assert.equal(result.error?.code, "AUTHENTICATION_FAILED");
  assert.equal(broker.events.length, 0);
});

test("accepts a Tekton report webhook and preserves completed status in data", async () => {
  const broker = new CapturingPublishBroker();
  const ingress = new EventIngressService(new EventPublisherService(broker, new MemoryEventArchiveRepository()), {
    tektonReportToken: "expected"
  });

  const result = await ingress.handle({
    source: "tekton",
    headers: { "x-fde-token": "expected" },
    environment: "test",
    body: {
      namespace: "ci",
      pipeline_run_name: "build-api",
      application: "api",
      status: "failed"
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(result.event?.type, "tekton.pipelinerun.completed");
  assert.equal((result.event?.data as Record<string, unknown>).status, "failed");
});

test("rejects unsupported ingress source with a stable error object", async () => {
  const broker = new CapturingPublishBroker();
  const ingress = new EventIngressService(new EventPublisherService(broker, new MemoryEventArchiveRepository()), {});

  const result = await ingress.handle({
    source: "unknown",
    headers: {},
    environment: "dev",
    body: {}
  });

  assert.equal(result.accepted, false);
  assert.equal(result.error?.code, "SCHEMA_VALIDATION_FAILED");
  assert.equal(result.error?.severity, "error");
  assert.equal(broker.events.length, 0);
});

class CapturingPublishBroker implements EventBroker {
  readonly events: CloudEvent[] = [];

  async publish<TData>(event: CloudEvent<TData>): Promise<void> {
    this.events.push(event as CloudEvent);
  }

  async publishDeadLetter(): Promise<void> {
    return;
  }

  async subscribe(): Promise<void> {
    return;
  }
}
