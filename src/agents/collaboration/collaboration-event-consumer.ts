import { createId } from "../../common/ids.js";
import type { IMConnectorService } from "../../connectors/feishu/connector.js";
import type { FeishuActionType, FeishuCallbackEvent } from "../../connectors/feishu/types.js";
import type { EventBroker } from "../../events/broker.js";
import type { CloudEvent } from "../../events/cloudevent.js";
import type { EventSubscriber } from "../../events/event-subscriber.js";
import type { IdempotencyStore } from "../../events/idempotency-store.js";

export interface CollaborationEventConsumerOptions {
  consumer_id?: string;
  queue_name?: string;
  max_attempts?: number;
  now?: () => Date;
}

export interface CollaborationProgressUpdatedData {
  message_id: string;
  status: CollaborationProgressStatus;
  actor?: {
    type: "user";
    id: string;
  };
  action_type: CollaborationProgressActionType;
  action_value?: string;
  updated_at: string;
}

export type CollaborationProgressStatus = "acknowledged" | "investigating";
export type CollaborationProgressActionType = "acknowledge" | "claim";

export class CollaborationEventConsumer {
  private readonly now: () => Date;

  constructor(
    private readonly subscriber: Pick<EventSubscriber, "subscribe">,
    private readonly connector: Pick<IMConnectorService, "updateCard">,
    private readonly broker: Pick<EventBroker, "publish">,
    private readonly idempotencyStore: IdempotencyStore,
    private readonly options: CollaborationEventConsumerOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    await this.subscriber.subscribe<FeishuCallbackEvent>(
      ["feishu.card.action_clicked"],
      async (event) => {
        await this.handleCardActionClicked(event);
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

function readProgressAction(actionType: FeishuActionType | undefined): CollaborationProgressActionType | undefined {
  if (actionType === "acknowledge" || actionType === "claim") {
    return actionType;
  }
  return undefined;
}

function toProgressStatus(action: CollaborationProgressActionType): CollaborationProgressStatus {
  if (action === "claim") {
    return "investigating";
  }
  return "acknowledged";
}

function toProgressUpdatedEvent(
  event: CloudEvent<FeishuCallbackEvent>,
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

function collaborationActionKey(messageId: string, actionType: string, actionValue: string | undefined): string {
  return `collaboration:action:${messageId}:${actionType}:${actionValue ?? ""}`;
}
