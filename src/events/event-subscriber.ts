import type { ErrorObject } from "../common/contracts.js";
import { loadZhMessages } from "../i18n/messages.js";
import { consumerKey, type IdempotencyStore } from "./idempotency-store.js";
import type { EventArchiveRepository } from "./archive.js";
import type { CloudEvent } from "./cloudevent.js";
import type { DeliveryContext, EventBroker, EventHandler, SubscribeOptions } from "./broker.js";
import type { EventType } from "./event-types.js";

export class EventSubscriber {
  constructor(
    private readonly broker: EventBroker,
    private readonly idempotencyStore: IdempotencyStore,
    private readonly archiveRepository: EventArchiveRepository
  ) {}

  async subscribe<TData>(eventTypes: EventType[], handler: EventHandler<TData>, options: SubscribeOptions): Promise<void> {
    await this.broker.subscribe<TData>(
      eventTypes,
      async (event, context) => {
        await this.handle(event, context, handler);
      },
      options
    );
  }

  private async handle<TData>(event: CloudEvent<TData>, context: DeliveryContext, handler: EventHandler<TData>): Promise<void> {
    const key = consumerKey(context.consumer_id, event.id);
    const existingState = await this.idempotencyStore.get(key);
    if (existingState === "processed") {
      context.outcome = "acked";
      return;
    }
    if (existingState === "failed") {
      context.outcome = "dead_lettered";
      return;
    }

    await this.idempotencyStore.set(key, "processing");
    await this.archiveRepository.recordDelivery({
      delivery_id: context.delivery_id,
      event_id: event.id,
      consumer_id: context.consumer_id,
      queue_name: context.queue_name,
      status: "processing",
      attempt_count: context.attempt_count,
      first_attempt_at: context.received_at,
      last_attempt_at: context.received_at
    });

    try {
      await handler(event, context);
      context.outcome = "acked";
      await this.idempotencyStore.set(key, "processed");
      await this.archiveRepository.recordDelivery({
        delivery_id: context.delivery_id,
        event_id: event.id,
        consumer_id: context.consumer_id,
        queue_name: context.queue_name,
        status: "processed",
        attempt_count: context.attempt_count,
        first_attempt_at: context.received_at,
        last_attempt_at: new Date().toISOString()
      });
    } catch (error) {
      const errorObject = normalizeDeliveryError(error);
      const shouldRetry = context.attempt_count < context.max_attempts && errorObject.retryable;
      await this.idempotencyStore.set(key, shouldRetry ? "processing" : "failed");
      await this.archiveRepository.recordDelivery({
        delivery_id: context.delivery_id,
        event_id: event.id,
        consumer_id: context.consumer_id,
        queue_name: context.queue_name,
        status: shouldRetry ? "processing" : "failed",
        attempt_count: context.attempt_count,
        first_attempt_at: context.received_at,
        last_attempt_at: new Date().toISOString(),
        error: errorObject
      });
      if (shouldRetry) {
        context.outcome = "retry";
        return;
      }
      await this.broker.publishDeadLetter(event, errorObject, context);
      await this.archiveRepository.recordDeadLetter({
        event,
        consumer_id: context.consumer_id,
        queue_name: context.queue_name,
        failed_at: new Date().toISOString(),
        reason_code: errorObject.code,
        error: errorObject
      });
      await this.idempotencyStore.set(key, "failed");
      context.outcome = "dead_lettered";
    }
  }
}

function normalizeDeliveryError(error: unknown): ErrorObject {
  if (isErrorObject(error)) {
    return error;
  }
  if (isErrorObjectCarrier(error)) {
    return error.error;
  }
  return {
    code: "DELIVERY_RETRY_EXHAUSTED",
    message: error instanceof Error ? error.message : loadZhMessages().events.delivery.consume_failed,
    retryable: true,
    severity: "error",
    details: {}
  };
}

function isErrorObject(value: unknown): value is ErrorObject {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.code === "string" &&
    typeof record.message === "string" &&
    typeof record.retryable === "boolean" &&
    typeof record.severity === "string";
}

function isErrorObjectCarrier(value: unknown): value is { error: ErrorObject } {
  if (!value || typeof value !== "object" || !("error" in value)) {
    return false;
  }
  return isErrorObject((value as { error?: unknown }).error);
}
