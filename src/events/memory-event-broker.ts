import { createId } from "../common/ids.js";
import type { ErrorObject } from "../common/contracts.js";
import type { CloudEvent } from "./cloudevent.js";
import type { DeliveryContext, EventBroker, EventHandler, SubscribeOptions } from "./broker.js";
import type { EventType } from "./event-types.js";

interface Subscription {
  eventTypes: Set<EventType>;
  handler: EventHandler;
  options: SubscribeOptions;
}

export class MemoryEventBroker implements EventBroker {
  private readonly subscriptions: Subscription[] = [];
  readonly deadLetters: Array<{ event: CloudEvent; error: ErrorObject; context: DeliveryContext }> = [];

  async publish<TData>(event: CloudEvent<TData>): Promise<void> {
    for (const subscription of this.subscriptions) {
      if (!subscription.eventTypes.has(event.type)) {
        continue;
      }
      const context: DeliveryContext = {
        delivery_id: createId("delivery"),
        consumer_id: subscription.options.consumer_id,
        queue_name: subscription.options.queue_name,
        attempt_count: 1,
        max_attempts: subscription.options.max_attempts ?? 3,
        received_at: new Date().toISOString(),
        trace_id: event.trace_id,
        correlation_id: event.correlation_id
      };
      await subscription.handler(event, context);
    }
  }

  async subscribe<TData>(eventTypes: EventType[], handler: EventHandler<TData>, options: SubscribeOptions): Promise<void> {
    this.subscriptions.push({
      eventTypes: new Set(eventTypes),
      handler: handler as EventHandler,
      options
    });
  }

  async publishDeadLetter<TData>(event: CloudEvent<TData>, error: ErrorObject, context: DeliveryContext): Promise<void> {
    this.deadLetters.push({ event: event as CloudEvent, error, context });
  }

  async ack(_deliveryId: string, context: DeliveryContext): Promise<void> {
    context.outcome = "acked";
  }

  async nack(_deliveryId: string, error: ErrorObject, context: DeliveryContext): Promise<void> {
    context.outcome = context.attempt_count < context.max_attempts && error.retryable ? "retry" : "dead_lettered";
  }
}
