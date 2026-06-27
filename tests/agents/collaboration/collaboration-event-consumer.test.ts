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
import { CollaborationEventConsumer, type CollaborationEscalationTriggeredData, type CollaborationNotificationResultData, type CollaborationProgressUpdatedData } from "../../../src/agents/collaboration/collaboration-event-consumer.js";

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

test("collaboration event consumer marks a Feishu card action as fixed", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore, {
    now: () => new Date("2026-06-27T02:00:00.000Z")
  });

  await consumer.start();
  await broker.publish(actionEvent("evt-action-fixed-001", "mark_fixed", "mark_fixed"));

  assert.equal(connector.updates.length, 1);
  assert.equal(connector.updates[0].message_id, "om_ack_001");
  assert.equal(connector.updates[0].data["status"], "fixed");
  assert.equal(connector.updates[0].data["action_type"], "mark_fixed");

  const progressEvent = broker.published.find((event) => event.type === "collaboration.progress.updated");
  assert.ok(progressEvent);
  const progressData = progressEvent.data as CollaborationProgressUpdatedData;
  assert.equal(progressData.status, "fixed");
  assert.equal(progressData.action_type, "mark_fixed");
  assert.equal(progressData.updated_at, "2026-06-27T02:00:00.000Z");
});

test("collaboration event consumer marks effective replies as investigating", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore, {
    now: () => new Date("2026-06-27T03:00:00.000Z")
  });

  await consumer.start();
  await broker.publish(replyEvent("evt-reply-001", "我正在处理这个问题"));

  assert.equal(connector.updates.length, 0);

  const progressEvent = broker.published.find((event) => event.type === "collaboration.progress.updated");
  assert.ok(progressEvent);
  const progressData = progressEvent.data as CollaborationProgressUpdatedData;
  assert.equal(progressData.status, "investigating");
  assert.equal(progressData.latest_reply, "我正在处理这个问题");
  assert.equal(progressData.reply_effectiveness, "effective");
  assert.equal(progressData.updated_at, "2026-06-27T03:00:00.000Z");
});

test("collaboration event consumer marks vague replies as ineffective", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore, {
    now: () => new Date("2026-06-27T04:00:00.000Z")
  });

  await consumer.start();
  await broker.publish(replyEvent("evt-reply-002", "收到"));

  assert.equal(connector.updates.length, 0);

  const progressEvent = broker.published.find((event) => event.type === "collaboration.progress.updated");
  assert.ok(progressEvent);
  const progressData = progressEvent.data as CollaborationProgressUpdatedData;
  assert.equal(progressData.status, "ineffective_reply");
  assert.equal(progressData.latest_reply, "收到");
  assert.equal(progressData.reply_effectiveness, "ineffective");
  assert.equal(progressData.action_type, undefined);
  assert.equal(progressData.updated_at, "2026-06-27T04:00:00.000Z");
});

test("collaboration event consumer records sent notifications as unread progress", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore, {
    now: () => new Date("2026-06-27T04:30:00.000Z")
  });

  await consumer.start();
  await broker.publish(notificationSentEvent("evt-notification-sent-001"));

  const progressEvent = broker.published.find((event) => event.type === "collaboration.progress.updated");
  assert.ok(progressEvent);
  const progressData = progressEvent.data as CollaborationProgressUpdatedData;
  assert.equal(progressData.status, "unread");
  assert.equal(progressData.notification_id, "ntf-sent-001");
  assert.equal(progressData.message_id, "om_sent_001");
  assert.equal(progressData.updated_at, "2026-06-27T04:30:00.000Z");
});

test("collaboration event consumer ignores duplicate sent notification progress records", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore);

  await consumer.start();
  await broker.publish(notificationSentEvent("evt-notification-sent-001"));
  await broker.publish(notificationSentEvent("evt-notification-sent-002"));

  assert.equal(broker.published.filter((event) => event.type === "collaboration.progress.updated").length, 1);
});

test("collaboration event consumer triggers escalation on notification timeout", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore, {
    now: () => new Date("2026-06-27T05:00:00.000Z")
  });

  await consumer.start();
  await broker.publish(timeoutEvent("evt-timeout-001"));

  assert.equal(connector.updates.length, 0);

  const progressEvent = broker.published.find((event) => event.type === "collaboration.progress.updated");
  assert.ok(progressEvent);
  const progressData = progressEvent.data as CollaborationProgressUpdatedData;
  assert.equal(progressData.status, "needs_escalation");
  assert.equal(progressData.message_id, "om_timeout_001");
  assert.equal(progressData.notification_id, "ntf-timeout-001");
  assert.equal(progressData.updated_at, "2026-06-27T05:00:00.000Z");

  const escalationEvent = broker.published.find((event) => event.type === "collaboration.escalation.triggered");
  assert.ok(escalationEvent);
  const escalationData = escalationEvent.data as CollaborationEscalationTriggeredData;
  assert.equal(escalationData.status, "needs_escalation");
  assert.equal(escalationData.reason_code, "notification_timeout");
  assert.equal(escalationData.message_id, "om_timeout_001");
  assert.equal(escalationData.notification_id, "ntf-timeout-001");
  assert.equal(escalationData.triggered_at, "2026-06-27T05:00:00.000Z");
});

test("collaboration event consumer ignores duplicate notification timeouts", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore);

  await consumer.start();
  await broker.publish(timeoutEvent("evt-timeout-001"));
  await broker.publish(timeoutEvent("evt-timeout-002"));

  assert.equal(broker.published.filter((event) => event.type === "collaboration.progress.updated").length, 1);
  assert.equal(broker.published.filter((event) => event.type === "collaboration.escalation.triggered").length, 1);
});

test("collaboration event consumer sends escalation notices to Feishu target", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore);

  await consumer.start();
  await broker.publish(escalationTriggeredEvent("evt-escalation-001"));

  assert.equal(connector.cards.length, 1);
  assert.equal(connector.cards[0].mode, "openapi_bot");
  assert.equal(connector.cards[0].target_type, "chat");
  assert.equal(connector.cards[0].target_id, "oc_escalation");
  assert.equal(connector.cards[0].card_type, "escalation_notice");
  assert.equal(connector.cards[0].data["reason_code"], "notification_timeout");

  const sentEvent = broker.published.find((event) => event.type === "collaboration.notification.sent");
  assert.ok(sentEvent);
  const sentData = sentEvent.data as CollaborationNotificationResultData;
  assert.equal(sentEvent.source, "collaboration");
  assert.equal(sentEvent.subject, "notification/ntf-timeout-001/escalation");
  assert.equal(sentData.status, "sent");
  assert.equal(sentData.message_id, "om_sent");
  assert.equal(sentData.target_id, "oc_escalation");
});

test("collaboration event consumer sends escalation notices to default target when event has no target", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore, {
    escalationTarget: {
      target_type: "chat",
      target_id: "oc_default_escalation"
    }
  });

  await consumer.start();
  await broker.publish(escalationTriggeredEventWithoutTarget("evt-escalation-default-001"));

  assert.equal(connector.cards.length, 1);
  assert.equal(connector.cards[0].target_type, "chat");
  assert.equal(connector.cards[0].target_id, "oc_default_escalation");

  const sentEvent = broker.published.find((event) => event.type === "collaboration.notification.sent");
  assert.ok(sentEvent);
  const sentData = sentEvent.data as CollaborationNotificationResultData;
  assert.equal(sentData.status, "sent");
  assert.equal(sentData.target_id, "oc_default_escalation");
});

test("collaboration event consumer ignores duplicate escalation notice sends", async () => {
  const broker = new CapturingBroker();
  const idempotencyStore = new MemoryIdempotencyStore();
  const subscriber = new EventSubscriber(broker, idempotencyStore, new MemoryEventArchiveRepository());
  const connector = new CapturingFeishuConnector();
  const consumer = new CollaborationEventConsumer(subscriber, connector, broker, idempotencyStore);

  await consumer.start();
  await broker.publish(escalationTriggeredEvent("evt-escalation-001"));
  await broker.publish(escalationTriggeredEvent("evt-escalation-002"));

  assert.equal(connector.cards.length, 1);
  assert.equal(broker.published.filter((event) => event.type === "collaboration.notification.sent").length, 1);
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
  readonly cards: SendCardInput[] = [];
  readonly updates: UpdateCardInput[] = [];

  async sendCard(input: SendCardInput): Promise<SendCardResult> {
    this.cards.push(input);
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
  actionType: "acknowledge" | "claim" | "mark_fixed" = "acknowledge",
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

function replyEvent(id: string, latestReply: string): CloudEvent<FeishuCallbackEvent> {
  return {
    specversion: "1.0",
    id,
    source: "feishu",
    type: "feishu.message.replied",
    subject: "message/om_reply_001",
    time: "2026-06-27T00:00:00.000Z",
    datacontenttype: "application/json",
    correlation_id: "corr-reply-001",
    trace_id: "trace-reply-001",
    run_id: "run-reply-001",
    application: "fde-workstation",
    environment: "prod",
    data: {
      type: "feishu.message.replied",
      message_id: "om_reply_001",
      environment: "prod",
      operator: "ou_user_001",
      latest_reply: latestReply,
      raw_callback_excerpt: "{}",
      correlation_id: "corr-reply-001",
      trace_id: "trace-reply-001",
      run_id: "run-reply-001"
    }
  };
}

function timeoutEvent(id: string): CloudEvent<Record<string, unknown>> {
  return {
    specversion: "1.0",
    id,
    source: "collaboration",
    type: "collaboration.notification.timeout",
    subject: "notification/ntf-timeout-001",
    time: "2026-06-27T00:00:00.000Z",
    datacontenttype: "application/json",
    correlation_id: "corr-timeout-001",
    trace_id: "trace-timeout-001",
    run_id: "run-timeout-001",
    application: "fde-workstation",
    environment: "prod",
    data: {
      notification_id: "ntf-timeout-001",
      message_id: "om_timeout_001",
      diagnosis_id: "diag-timeout-001",
      timeout_reason: "no_response"
    }
  };
}

function notificationSentEvent(id: string): CloudEvent<Record<string, unknown>> {
  return {
    specversion: "1.0",
    id,
    source: "collaboration",
    type: "collaboration.notification.sent",
    subject: "notification/ntf-sent-001",
    time: "2026-06-27T04:20:00.000Z",
    datacontenttype: "application/json",
    correlation_id: "corr-sent-001",
    trace_id: "trace-sent-001",
    run_id: "run-sent-001",
    application: "fde-workstation",
    environment: "prod",
    data: {
      notification_id: "ntf-sent-001",
      status: "sent",
      message_id: "om_sent_001",
      target_id: "oc_target",
      sent_at: "2026-06-27T04:20:00.000Z"
    }
  };
}

function escalationTriggeredEvent(id: string): CloudEvent<Record<string, unknown>> {
  return {
    specversion: "1.0",
    id,
    source: "collaboration",
    type: "collaboration.escalation.triggered",
    subject: "notification/ntf-timeout-001/escalation",
    time: "2026-06-27T05:00:00.000Z",
    datacontenttype: "application/json",
    correlation_id: "corr-escalation-001",
    trace_id: "trace-escalation-001",
    run_id: "run-escalation-001",
    application: "fde-workstation",
    environment: "prod",
    data: {
      notification_id: "ntf-timeout-001",
      message_id: "om_timeout_001",
      diagnosis_id: "diag-timeout-001",
      status: "needs_escalation",
      reason_code: "notification_timeout",
      reason: "no_response",
      target_type: "chat",
      target_id: "oc_escalation",
      triggered_at: "2026-06-27T05:00:00.000Z"
    }
  };
}

function escalationTriggeredEventWithoutTarget(id: string): CloudEvent<Record<string, unknown>> {
  return {
    specversion: "1.0",
    id,
    source: "collaboration",
    type: "collaboration.escalation.triggered",
    subject: "notification/ntf-timeout-001/escalation",
    time: "2026-06-27T05:00:00.000Z",
    datacontenttype: "application/json",
    correlation_id: "corr-escalation-001",
    trace_id: "trace-escalation-001",
    run_id: "run-escalation-001",
    application: "fde-workstation",
    environment: "prod",
    data: {
      notification_id: "ntf-timeout-001",
      message_id: "om_timeout_001",
      diagnosis_id: "diag-timeout-001",
      status: "needs_escalation",
      reason_code: "notification_timeout",
      reason: "no_response",
      triggered_at: "2026-06-27T05:00:00.000Z"
    }
  };
}
