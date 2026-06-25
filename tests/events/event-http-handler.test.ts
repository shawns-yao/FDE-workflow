import test from "node:test";
import assert from "node:assert/strict";
import { MemoryFeishuConnector } from "../../src/connectors/feishu/memory-feishu-connector.js";
import { FeishuCallbackHandler } from "../../src/connectors/feishu/callback-handler.js";
import { MemoryEventArchiveRepository } from "../../src/events/archive.js";
import type { EventBroker } from "../../src/events/broker.js";
import type { CloudEvent } from "../../src/events/cloudevent.js";
import { EventHttpHandler } from "../../src/events/event-http-handler.js";
import { EventIngressService } from "../../src/events/event-ingress-service.js";
import { EventPublisherService } from "../../src/events/event-publisher.js";

test("event http handler accepts gitlab webhook path and publishes normalized event", async () => {
  const broker = new CapturingBroker();
  const publisher = new EventPublisherService(broker, new MemoryEventArchiveRepository());
  const handler = new EventHttpHandler({
    ingress: new EventIngressService(publisher, { gitlabToken: "expected" })
  });

  const response = await handler.handle({
    method: "POST",
    path: "/webhook/gitlab",
    headers: { "x-gitlab-token": "expected" },
    rawBody: JSON.stringify({
      project_id: 1,
      merge_request_iid: 2,
      project_name: "api"
    }),
    environment: "dev"
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.accepted, true);
  assert.equal(broker.events.length, 1);
  assert.equal(broker.events[0].type, "gitlab.mr.updated");
});

test("event http handler returns bad request for invalid json", async () => {
  const handler = new EventHttpHandler({
    ingress: new EventIngressService(new EventPublisherService(new CapturingBroker(), new MemoryEventArchiveRepository()), {})
  });

  const response = await handler.handle({
    method: "POST",
    path: "/webhook/gitlab",
    headers: {},
    rawBody: "{",
    environment: "dev"
  });

  assert.equal(response.statusCode, 400);
  assertErrorCode(response.body.error, "SCHEMA_VALIDATION_FAILED");
});

test("event http handler handles feishu callback challenge", async () => {
  const publisher = new EventPublisherService(new CapturingBroker(), new MemoryEventArchiveRepository());
  const handler = new EventHttpHandler({
    ingress: new EventIngressService(publisher, {}),
    feishuCallback: new FeishuCallbackHandler(new MemoryFeishuConnector(), publisher, {
      verificationToken: "expected"
    })
  });

  const response = await handler.handle({
    method: "POST",
    path: "/webhook/feishu",
    headers: {},
    rawBody: JSON.stringify({
      type: "url_verification",
      token: "expected",
      challenge: "challenge-value"
    }),
    environment: "dev"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { challenge: "challenge-value" });
});

test("event http handler rejects unsupported route", async () => {
  const handler = new EventHttpHandler({
    ingress: new EventIngressService(new EventPublisherService(new CapturingBroker(), new MemoryEventArchiveRepository()), {})
  });

  const response = await handler.handle({
    method: "POST",
    path: "/webhook/unknown",
    headers: {},
    rawBody: "{}",
    environment: "dev"
  });

  assert.equal(response.statusCode, 404);
  assertErrorCode(response.body.error, "SCHEMA_VALIDATION_FAILED");
});

class CapturingBroker implements EventBroker {
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

function assertErrorCode(error: unknown, code: string): void {
  assert.ok(error && typeof error === "object");
  assert.equal((error as { code?: string }).code, code);
}
