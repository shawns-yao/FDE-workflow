import test from "node:test";
import assert from "node:assert/strict";
import { MemoryEventArchiveRepository } from "../../../src/events/archive.js";
import type { DeliveryContext, EventBroker, EventHandler, SubscribeOptions } from "../../../src/events/broker.js";
import type { CloudEvent } from "../../../src/events/cloudevent.js";
import { EventSubscriber } from "../../../src/events/event-subscriber.js";
import type { EventType } from "../../../src/events/event-types.js";
import { MemoryIdempotencyStore } from "../../../src/events/idempotency-store.js";
import type { IMConnectorService } from "../../../src/connectors/feishu/connector.js";
import type { FeishuCallbackEvent, FeishuCallbackInput, MentionUserInput, MentionUserResult, ReplyMessageInput, ReplyMessageResult, SendCardInput, SendCardResult, UpdateCardInput } from "../../../src/connectors/feishu/types.js";
import { CollaborationEventConsumer, type CollaborationProgressUpdatedData } from "../../../src/agents/collaboration/collaboration-event-consumer.js";

test("collaboration event consumer acknowledges a Feishu card action", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore, {
    now: () => new Date("2026-06-27T00:00:00.000Z")
  });

  await consumer.start();
  await broker.publish(actionEvent("evt-action-001"));

  assert.equal(connector.updates.length, 1);
  assert.equal(connector.updates[0].message_id, "om_ack_001");
  assert.equal(connector.updates[0].data["status"], "acknowledged");
  assert.deepEqual(connector.updates[0].data["actor"], {
    type: "user",
    id: "ou_user_001"
  });
  assert.equal(connector.updates[0].actions?.length, 0);

  const progressEvent = broker.published.find((event) => event.type === "collaboration.progress.updated");
  assert.ok(progressEvent);
  const progressData = progressEvent.data as CollaborationProgressUpdatedData;
  assert.equal(progressEvent.source, "collaboration");
  assert.equal(progressEvent.subject, "feishu/om_ack_001/progress");
  assert.equal(progressData.status, "acknowledged");
  assert.equal(progressData.message_id, "om_ack_001");
  assert.equal(progressData.updated_at, "2026-06-27T00:00:00.000Z");
});

test("collaboration event consumer ignores duplicate acknowledge clicks for the same card action", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore);

  await consumer.start();
  await broker.publish(actionEvent("evt-action-001"));
  await broker.publish(actionEvent("evt-action-002"));

  assert.equal(connector.updates.length, 1);
  assert.equal(broker.published.filter((event) => event.type === "collaboration.progress.updated").length, 1);
});

test("collaboration event consumer claims a Feishu card action as investigating", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore, {
    now: () => new Date("2026-06-27T01:00:00.000Z")
  });

  await consumer.start();
  await broker.publish(actionEvent("evt-action-claim-001", "claim", "claim_issue"));

  assert.equal(connector.updates.length, 1);
  assert.equal(connector.updates[0].message_id, "om_ack_001");
  assert.equal(connector.updates[0].data["status"], "investigating");
  assert.equal(connector.updates[0].data["action_type"], "claim");

  const progressEvent = broker.published.find((event) => event.type === "collaboration.progress.updated");
  assert.ok(progressEvent);
  const progressData = progressEvent.data as CollaborationProgressUpdatedData;
  assert.equal(progressData.status, "investigating");
  assert.equal(progressData.action_type, "claim");
  assert.equal(progressData.updated_at, "2026-06-27T01:00:00.000Z");
});

class CapturingBroker implements EventBroker {
  private readonly subscriptions: Array<{ eventTypes: EventType[]; handler: EventHandler; options: SubscribeOptions }> = [];
  readonly published: CloudEvent[] = [];
  readonly deadLetters: Array<{ event: CloudEvent; error: unknown; context: DeliveryContext }> = [];

  async publish<TData>(event: CloudEvent<TData>): Promise<void> {
    this.published.push(event as CloudEvent);
    for (const subscription of this.subscriptions) {
      if (!subscription.eventTypes.includes(event.type)) {
        continue;
      }
      await subscription.handler(event, {
        delivery_id: `delivery-${this.published.length}`,
        consumer_id: subscription.options.consumer_id,
        queue_name: subscription.options.queue_name,
        attempt_count: 1,
        max_attempts: subscription.options.max_attempts ?? 3,
        received_at: "2026-06-27T00:00:00.000Z",
        trace_id: event.trace_id,
        correlation_id: event.correlation_id
      });
    }
  }

  async subscribe<TData>(eventTypes: EventType[], handler: EventHandler<TData>, options: SubscribeOptions): Promise<void> {
    this.subscriptions.push({
      eventTypes,
      handler: handler as EventHandler,
      options
    });
  }

  async publishDeadLetter<TData>(event: CloudEvent<TData>, error: unknown, context: DeliveryContext): Promise<void> {
    this.deadLetters.push({ event: event as CloudEvent, error, context });
  }
}

class CapturingFeishuConnector implements IMConnectorService {
  readonly updates: UpdateCardInput[] = [];

  async sendCard(input: SendCardInput): Promise<SendCardResult> {
    return {
      status: "sent",
      message_id: "om_sent",
      target_id: input.target_id,
      sent_at: "2026-06-27T00:00:00.000Z"
    };
  }

  async updateCard(input: UpdateCardInput): Promise<void> {
    this.updates.push(input);
  }

  async replyMessage(input: ReplyMessageInput): Promise<ReplyMessageResult> {
    return {
      status: "sent",
      message_id: "om_reply",
      reply_to_message_id: input.message_id,
      sent_at: "2026-06-27T00:00:00.000Z"
    };
  }

  mentionUser(input: MentionUserInput): MentionUserResult {
    return {
      type: "mention",
      user_id: input.user_id,
      fragment: {
        text: input.content
      }
    };
  }

  async handleCallback(input: FeishuCallbackInput): Promise<FeishuCallbackEvent> {
    return {
      type: "feishu.card.action_clicked",
      message_id: String(input.raw["message_id"] ?? ""),
      environment: input.environment,
      raw_callback_excerpt: JSON.stringify(input.raw).slice(0, 256),
      correlation_id: input.correlation_id,
      trace_id: input.trace_id,
      run_id: input.run_id
    };
  }
}

function actionEvent(
  id: string,
  actionType: "acknowledge" | "claim" = "acknowledge",
  actionValue = "startup_acknowledge"
): CloudEvent<FeishuCallbackEvent> {
  return {
    specversion: "1.0",
    id,
    source: "feishu",
    type: "feishu.card.action_clicked",
    subject: "feishu/om_ack_001",
    time: "2026-06-27T00:00:00.000Z",
    datacontenttype: "application/json",
    correlation_id: "corr-ack-001",
    trace_id: "trace-ack-001",
    run_id: "run-ack-001",
    application: "fde-workstation",
    environment: "prod",
    data: {
      type: "feishu.card.action_clicked",
      message_id: "om_ack_001",
      environment: "prod",
      action: {
        type: actionType,
        label: actionType,
        value: actionValue
      },
      operator: "ou_user_001",
      raw_callback_excerpt: "{}",
      correlation_id: "corr-ack-001",
      trace_id: "trace-ack-001",
      run_id: "run-ack-001"
    }
  };
}
