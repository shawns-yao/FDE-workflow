import { createId } from "../../common/ids.js";
import type { IMConnectorService } from "../../connectors/feishu/connector.js";
import type { FeishuActionType, FeishuCallbackEvent, FeishuTargetType, SendCardResult } from "../../connectors/feishu/types.js";
import type { EventBroker } from "../../events/broker.js";
import type { CloudEvent } from "../../events/cloudevent.js";
import type { EventSubscriber } from "../../events/event-subscriber.js";
import type { IdempotencyStore } from "../../events/idempotency-store.js";

export interface CollaborationEventConsumerOptions {
  consumer_id?: string;
  queue_name?: string;
  max_attempts?: number;
  now?: () => Date;
  escalationTarget?: CollaborationEscalationTarget;
}

export interface CollaborationEscalationTarget {
  target_type: FeishuTargetType;
  target_id: string;
}

export interface CollaborationProgressUpdatedData {
  message_id: string;
  notification_id?: string;
  diagnosis_id?: string;
  status: CollaborationProgressStatus;
  actor?: {
    type: "user";
    id: string;
  };
  action_type?: CollaborationProgressActionType;
  action_value?: string;
  latest_reply?: string;
  reply_effectiveness?: CollaborationReplyEffectiveness;
  updated_at: string;
}

export interface CollaborationNotificationTimeoutData {
  notification_id?: string;
  message_id?: string;
  diagnosis_id?: string;
  timeout_reason?: string;
}

export interface CollaborationEscalationTriggeredData {
  notification_id?: string;
  message_id: string;
  diagnosis_id?: string;
  status: "needs_escalation";
  reason_code: "notification_timeout";
  reason?: string;
  target_type?: FeishuTargetType;
  target_id?: string;
  triggered_at: string;
}

export interface CollaborationNotificationResultData {
  notification_id?: string;
  escalation_message_id?: string;
  status: "sent" | "failed";
  message_id?: string;
  target_id: string;
  sent_at?: string;
  error?: SendCardResult["error"];
}

export type CollaborationProgressStatus = "unread" | "acknowledged" | "investigating" | "fixed" | "ineffective_reply" | "needs_escalation" | "escalated";
export type CollaborationProgressActionType = "acknowledge" | "claim" | "mark_fixed";
export type CollaborationReplyEffectiveness = "effective" | "ineffective";
type CollaborationConsumerEventData = FeishuCallbackEvent | CollaborationNotificationResultData | CollaborationNotificationTimeoutData | CollaborationEscalationTriggeredData;

export class CollaborationEventConsumer {
  private readonly now: () => Date;

  constructor(
    private readonly subscriber: Pick<EventSubscriber, "subscribe">,
    private readonly connector: Pick<IMConnectorService, "sendCard" | "updateCard">,
    private readonly broker: Pick<EventBroker, "publish">,
    private readonly idempotencyStore: IdempotencyStore,
    private readonly options: CollaborationEventConsumerOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    await this.subscriber.subscribe<CollaborationConsumerEventData>(
      ["feishu.card.action_clicked", "feishu.message.replied", "collaboration.notification.sent", "collaboration.notification.timeout", "collaboration.escalation.triggered"],
      async (event) => {
        if (event.type === "collaboration.escalation.triggered") {
          await this.handleEscalationTriggered(event as CloudEvent<CollaborationEscalationTriggeredData>);
          return;
        }
        if (event.type === "collaboration.notification.sent") {
          await this.handleNotificationSent(event as CloudEvent<CollaborationNotificationResultData>);
          return;
        }
        if (event.type === "collaboration.notification.timeout") {
          await this.handleNotificationTimeout(event as CloudEvent<CollaborationNotificationTimeoutData>);
          return;
        }
        if (event.type === "feishu.message.replied") {
          await this.handleMessageReplied(event as CloudEvent<FeishuCallbackEvent>);
          return;
        }
        await this.handleCardActionClicked(event as CloudEvent<FeishuCallbackEvent>);
      },
      {
        consumer_id: this.options.consumer_id ?? "collaboration-agent",
        queue_name: this.options.queue_name ?? "agent.collaboration",
        max_attempts: this.options.max_attempts ?? 3
      }
    );
  }

  private async handleCardActionClicked(event: CloudEvent<FeishuCallbackEvent>): Promise<void> {
    const action = readProgressAction(event.data.action?.type);
    if (!action) {
      return;
    }

    const messageId = event.data.message_id.trim();
    if (!messageId) {
      return;
    }

    const idempotencyKey = collaborationActionKey(messageId, action, event.data.action?.value);
    const existingState = await this.idempotencyStore.get(idempotencyKey);
    if (existingState === "processed" || existingState === "processing") {
      return;
    }

    await this.idempotencyStore.set(idempotencyKey, "processing");
    try {
      const updatedAt = this.now().toISOString();
      const progress = toProgressUpdatedData(event, messageId, action, updatedAt);
      await this.connector.updateCard({
        mode: "openapi_bot",
        message_id: messageId,
        card_type: "custom",
        title: "FDE Workstation",
        summary: `Status: ${progress.status}`,
        severity: progress.status === "investigating" ? "medium" : "low",
        actions: [],
        data: {
          ...progress
        },
        correlation_id: event.correlation_id,
        trace_id: event.trace_id,
        run_id: event.run_id
      });
      await this.broker.publish(toProgressUpdatedEvent(event, progress));
      await this.idempotencyStore.set(idempotencyKey, "processed");
    } catch (error) {
      await this.idempotencyStore.set(idempotencyKey, "failed");
      throw error;
    }
  }

  private async handleMessageReplied(event: CloudEvent<FeishuCallbackEvent>): Promise<void> {
    const latestReply = event.data.latest_reply?.trim();
    if (!latestReply) {
      return;
    }

    const updatedAt = this.now().toISOString();
    const progress = toReplyProgressUpdatedData(event, latestReply, updatedAt);
    await this.broker.publish(toProgressUpdatedEvent(event, progress));
  }

  private async handleNotificationSent(event: CloudEvent<CollaborationNotificationResultData>): Promise<void> {
    const messageId = event.data.message_id?.trim();
    if (!messageId) {
      return;
    }
    const progressMessageId = event.data.escalation_message_id?.trim() || messageId;
    const progressStatus: CollaborationProgressStatus = event.data.escalation_message_id?.trim() ? "escalated" : "unread";

    const idempotencyKey = collaborationNotificationSentKey(event.data.notification_id, progressMessageId, progressStatus);
    const existingState = await this.idempotencyStore.get(idempotencyKey);
    if (existingState === "processed" || existingState === "processing") {
      return;
    }

    await this.idempotencyStore.set(idempotencyKey, "processing");
    try {
      const updatedAt = this.now().toISOString();
      const progress = toNotificationSentProgressUpdatedData(event, progressMessageId, progressStatus, updatedAt);
      await this.broker.publish(toProgressUpdatedEvent(event, progress));
      await this.idempotencyStore.set(idempotencyKey, "processed");
    } catch (error) {
      await this.idempotencyStore.set(idempotencyKey, "failed");
      throw error;
    }
  }

  private async handleNotificationTimeout(event: CloudEvent<CollaborationNotificationTimeoutData>): Promise<void> {
    const messageId = event.data.message_id?.trim();
    if (!messageId) {
      return;
    }

    const idempotencyKey = collaborationTimeoutKey(event.data.notification_id, messageId);
    const existingState = await this.idempotencyStore.get(idempotencyKey);
    if (existingState === "processed" || existingState === "processing") {
      return;
    }

    await this.idempotencyStore.set(idempotencyKey, "processing");
    const updatedAt = this.now().toISOString();
    try {
      const progress = toTimeoutProgressUpdatedData(event, messageId, updatedAt);
      await this.broker.publish(toProgressUpdatedEvent(event, progress));
      await this.broker.publish(toEscalationTriggeredEvent(event, toEscalationTriggeredData(event, messageId, updatedAt)));
      await this.idempotencyStore.set(idempotencyKey, "processed");
    } catch (error) {
      await this.idempotencyStore.set(idempotencyKey, "failed");
      throw error;
    }
  }

  private async handleEscalationTriggered(event: CloudEvent<CollaborationEscalationTriggeredData>): Promise<void> {
    const target = readEscalationTarget(event.data, this.options.escalationTarget);
    if (!target) {
      return;
    }

    const idempotencyKey = collaborationEscalationSendKey(event.data.notification_id, event.data.message_id, target.target_type, target.target_id);
    const existingState = await this.idempotencyStore.get(idempotencyKey);
    if (existingState === "processed" || existingState === "processing") {
      return;
    }

    await this.idempotencyStore.set(idempotencyKey, "processing");
    try {
      const result = await this.connector.sendCard({
        mode: "openapi_bot",
        target_type: target.target_type,
        target_id: target.target_id,
        card_type: "escalation_notice",
        title: "FDE Workstation Escalation",
        summary: `Escalation required: ${event.data.reason_code}`,
        severity: "high",
        actions: [],
        data: {
          ...event.data,
          target_type: target.target_type,
          target_id: target.target_id
        },
        correlation_id: event.correlation_id,
        trace_id: event.trace_id,
        run_id: event.run_id
      });

      await this.broker.publish(toNotificationResultEvent(event, result));
      await this.idempotencyStore.set(idempotencyKey, result.status === "sent" ? "processed" : "failed");
    } catch (error) {
      await this.idempotencyStore.set(idempotencyKey, "failed");
      throw error;
    }
  }
}

function readEscalationTarget(
  data: CollaborationEscalationTriggeredData,
  fallback: CollaborationEscalationTarget | undefined
): CollaborationEscalationTarget | undefined {
  const eventTargetId = data.target_id?.trim();
  if (data.target_type && eventTargetId) {
    return {
      target_type: data.target_type,
      target_id: eventTargetId
    };
  }

  const fallbackTargetId = fallback?.target_id.trim();
  if (!fallback || !fallbackTargetId) {
    return undefined;
  }

  return {
    target_type: fallback.target_type,
    target_id: fallbackTargetId
  };
}

function toProgressUpdatedData(
  event: CloudEvent<FeishuCallbackEvent>,
  messageId: string,
  action: CollaborationProgressActionType,
  updatedAt: string
): CollaborationProgressUpdatedData {
  return {
    message_id: messageId,
    status: toProgressStatus(action),
    actor: event.data.operator ? {
      type: "user",
      id: event.data.operator
    } : undefined,
    action_type: action,
    action_value: event.data.action?.value,
    updated_at: updatedAt
  };
}

function toReplyProgressUpdatedData(
  event: CloudEvent<FeishuCallbackEvent>,
  latestReply: string,
  updatedAt: string
): CollaborationProgressUpdatedData {
  const replyEffectiveness = classifyReply(latestReply);
  return {
    message_id: event.data.message_id,
    status: replyEffectiveness === "effective" ? "investigating" : "ineffective_reply",
    actor: event.data.operator ? {
      type: "user",
      id: event.data.operator
    } : undefined,
    latest_reply: latestReply,
    reply_effectiveness: replyEffectiveness,
    updated_at: updatedAt
  };
}

function toNotificationSentProgressUpdatedData(
  event: CloudEvent<CollaborationNotificationResultData>,
  messageId: string,
  status: Extract<CollaborationProgressStatus, "unread" | "escalated">,
  updatedAt: string
): CollaborationProgressUpdatedData {
  return {
    notification_id: event.data.notification_id,
    message_id: messageId,
    status,
    updated_at: updatedAt
  };
}

function toTimeoutProgressUpdatedData(
  event: CloudEvent<CollaborationNotificationTimeoutData>,
  messageId: string,
  updatedAt: string
): CollaborationProgressUpdatedData {
  return {
    notification_id: event.data.notification_id,
    message_id: messageId,
    diagnosis_id: event.data.diagnosis_id,
    status: "needs_escalation",
    updated_at: updatedAt
  };
}

function toEscalationTriggeredData(
  event: CloudEvent<CollaborationNotificationTimeoutData>,
  messageId: string,
  triggeredAt: string
): CollaborationEscalationTriggeredData {
  return {
    notification_id: event.data.notification_id,
    message_id: messageId,
    diagnosis_id: event.data.diagnosis_id,
    status: "needs_escalation",
    reason_code: "notification_timeout",
    reason: event.data.timeout_reason,
    triggered_at: triggeredAt
  };
}

function classifyReply(reply: string): CollaborationReplyEffectiveness {
  if (/正在|处理|排查|查看|修复|我来|认领/u.test(reply)) {
    return "effective";
  }
  return "ineffective";
}

function readProgressAction(actionType: FeishuActionType | undefined): CollaborationProgressActionType | undefined {
  if (actionType === "acknowledge" || actionType === "claim" || actionType === "mark_fixed") {
    return actionType;
  }
  return undefined;
}

function toProgressStatus(action: CollaborationProgressActionType): CollaborationProgressStatus {
  if (action === "claim") {
    return "investigating";
  }
  if (action === "mark_fixed") {
    return "fixed";
  }
  return "acknowledged";
}

function toProgressUpdatedEvent(
  event: CloudEvent<FeishuCallbackEvent | CollaborationNotificationResultData | CollaborationNotificationTimeoutData>,
  progress: CollaborationProgressUpdatedData
): CloudEvent<CollaborationProgressUpdatedData> {
  return {
    specversion: "1.0",
    id: createId("evt"),
    source: "collaboration",
    type: "collaboration.progress.updated",
    subject: `feishu/${progress.message_id}/progress`,
    time: progress.updated_at,
    datacontenttype: "application/json",
    correlation_id: event.correlation_id,
    trace_id: event.trace_id,
    run_id: event.run_id,
    application: event.application,
    environment: event.environment,
    data: progress
  };
}

function toEscalationTriggeredEvent(
  event: CloudEvent<CollaborationNotificationTimeoutData>,
  escalation: CollaborationEscalationTriggeredData
): CloudEvent<CollaborationEscalationTriggeredData> {
  return {
    specversion: "1.0",
    id: createId("evt"),
    source: "collaboration",
    type: "collaboration.escalation.triggered",
    subject: `notification/${escalation.notification_id ?? escalation.message_id}/escalation`,
    time: escalation.triggered_at,
    datacontenttype: "application/json",
    correlation_id: event.correlation_id,
    trace_id: event.trace_id,
    run_id: event.run_id,
    application: event.application,
    environment: event.environment,
    data: escalation
  };
}

function toNotificationResultEvent(
  event: CloudEvent<CollaborationEscalationTriggeredData>,
  result: SendCardResult
): CloudEvent<CollaborationNotificationResultData> {
  const sent = result.status === "sent";
  const data: CollaborationNotificationResultData = {
    notification_id: event.data.notification_id,
    escalation_message_id: event.data.message_id,
    status: result.status,
    message_id: result.message_id,
    target_id: result.target_id,
    sent_at: result.sent_at,
    error: result.error
  };
  return {
    specversion: "1.0",
    id: createId("evt"),
    source: "collaboration",
    type: sent ? "collaboration.notification.sent" : "collaboration.notification.failed",
    subject: `notification/${event.data.notification_id ?? event.data.message_id}/escalation`,
    time: result.sent_at ?? new Date().toISOString(),
    datacontenttype: "application/json",
    correlation_id: event.correlation_id,
    trace_id: event.trace_id,
    run_id: event.run_id,
    application: event.application,
    environment: event.environment,
    data
  };
}

function collaborationActionKey(messageId: string, actionType: string, actionValue: string | undefined): string {
  return `collaboration:action:${messageId}:${actionType}:${actionValue ?? ""}`;
}

function collaborationTimeoutKey(notificationId: string | undefined, messageId: string): string {
  return `collaboration:timeout:${notificationId?.trim() || messageId}`;
}

function collaborationNotificationSentKey(notificationId: string | undefined, messageId: string, status: CollaborationProgressStatus): string {
  return `collaboration:notification-sent:${notificationId?.trim() || messageId}:${status}:${messageId}`;
}

function collaborationEscalationSendKey(
  notificationId: string | undefined,
  messageId: string,
  targetType: FeishuTargetType,
  targetId: string
): string {
  return `collaboration:escalation:${notificationId?.trim() || messageId}:${targetType}:${targetId}`;
}
