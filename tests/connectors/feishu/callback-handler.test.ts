import test from "node:test";
import assert from "node:assert/strict";
import type { ErrorObject } from "../../../src/common/contracts.js";
import { FeishuCallbackHandler } from "../../../src/connectors/feishu/callback-handler.js";
import { MemoryFeishuConnector } from "../../../src/connectors/feishu/memory-feishu-connector.js";
import { MemoryEventArchiveRepository } from "../../../src/events/archive.js";
import type { DeliveryContext, EventBroker, EventHandler, SubscribeOptions } from "../../../src/events/broker.js";
import type { CloudEvent } from "../../../src/events/cloudevent.js";
import { EventPublisherService } from "../../../src/events/event-publisher.js";
import type { EventType } from "../../../src/events/event-types.js";

test("feishu callback handler returns url verification challenge without publishing event", async () => {
  const broker = new CapturingBroker();
  const handler = new FeishuCallbackHandler(
    new MemoryFeishuConnector(),
    new EventPublisherService(broker, new MemoryEventArchiveRepository()),
    {
      verificationToken: "expected"
    }
  );

  const result = await handler.handle({
    rawBody: JSON.stringify({
      type: "url_verification",
      token: "expected",
      challenge: "challenge-value"
    }),
    headers: {},
    environment: "dev",
    correlation_id: "corr-feishu",
    trace_id: "trace-feishu",
    run_id: "run-feishu"
  });

  assert.equal(result.accepted, true);
  assert.equal(result.challenge, "challenge-value");
  assert.equal(broker.events.length, 0);
});

test("feishu callback handler rejects callback when verification fails", async () => {
  const broker = new CapturingBroker();
  const handler = new FeishuCallbackHandler(
    new MemoryFeishuConnector(),
    new EventPublisherService(broker, new MemoryEventArchiveRepository()),
    {
      verificationToken: "expected"
    }
  );

  const result = await handler.handle({
    rawBody: JSON.stringify({
      type: "url_verification",
      token: "bad",
      challenge: "challenge-value"
    }),
    headers: {},
    environment: "dev",
    correlation_id: "corr-feishu",
    trace_id: "trace-feishu",
    run_id: "run-feishu"
  });

  assert.equal(result.accepted, false);
  assert.equal(result.error?.code, "AUTHENTICATION_FAILED");
  assert.equal(broker.events.length, 0);
});

test("feishu callback handler publishes action callback as CloudEvent", async () => {
  const broker = new CapturingBroker();
  const handler = new FeishuCallbackHandler(
    new MemoryFeishuConnector(),
    new EventPublisherService(broker, new MemoryEventArchiveRepository()),
    {}
  );

  const result = await handler.handle({
    rawBody: JSON.stringify({
      message_id: "msg-1",
      operator: "ou-user",
      action: {
        type: "claim",
        label: "claim",
        value: "ticket-1"
      }
    }),
    headers: {},
    environment: "test",
    correlation_id: "corr-feishu",
    trace_id: "trace-feishu",
    run_id: "run-feishu"
  });

  assert.equal(result.accepted, true);
  assert.equal(result.callback?.type, "feishu.card.action_clicked");
  assert.equal(result.publish_result?.published, true);
  assert.equal(broker.events.length, 1);
  assert.equal(broker.events[0].source, "feishu");
  assert.equal(broker.events[0].type, "feishu.card.action_clicked");
  assert.equal(broker.events[0].correlation_id, "corr-feishu");
});

test("feishu callback handler publishes message reply with latest reply text", async () => {
  const broker = new CapturingBroker();
  const handler = new FeishuCallbackHandler(
    new MemoryFeishuConnector(),
    new EventPublisherService(broker, new MemoryEventArchiveRepository()),
    {}
  );

  const result = await handler.handle({
    rawBody: JSON.stringify({
      message_id: "msg-reply-1",
      operator: "ou-user",
      content: "{\"text\":\"我正在处理这个问题\"}"
    }),
    headers: {},
    environment: "test",
    correlation_id: "corr-feishu",
    trace_id: "trace-feishu",
    run_id: "run-feishu"
  });

  assert.equal(result.accepted, true);
  assert.equal(result.callback?.type, "feishu.message.replied");
  assert.equal(result.callback?.latest_reply, "我正在处理这个问题");
  assert.equal(broker.events.length, 1);
  assert.equal(broker.events[0].type, "feishu.message.replied");
});

class CapturingBroker implements EventBroker {
  readonly events: CloudEvent[] = [];

  async publish<TData>(event: CloudEvent<TData>): Promise<void> {
    this.events.push(event as CloudEvent);
  }

  async publishDeadLetter<TData>(_event: CloudEvent<TData>, _error: ErrorObject, _context: DeliveryContext): Promise<void> {
    return;
  }

  async subscribe<TData>(_eventTypes: EventType[], _handler: EventHandler<TData>, _options: SubscribeOptions): Promise<void> {
    return;
  }
}
