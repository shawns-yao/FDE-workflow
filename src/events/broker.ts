import type { ErrorObject } from "../common/contracts.js";
import type { CloudEvent } from "./cloudevent.js";
import type { EventType } from "./event-types.js";

export type EventHandler<TData = unknown> = (event: CloudEvent<TData>, context: DeliveryContext) => Promise<void>;

export interface DeliveryContext {
  delivery_id: string;
  stream_id?: string;
  consumer_id: string;
  queue_name: string;
  attempt_count: number;
  max_attempts: number;
  received_at: string;
  trace_id: string;
  correlation_id: string;
  outcome?: "acked" | "retry" | "dead_lettered";
}

export interface EventBroker {
  publish<TData>(event: CloudEvent<TData>): Promise<void>;
  publishDeadLetter<TData>(event: CloudEvent<TData>, error: ErrorObject, context: DeliveryContext): Promise<void>;
  subscribe<TData>(eventTypes: EventType[], handler: EventHandler<TData>, options: SubscribeOptions): Promise<void>;
  ack?(deliveryId: string, context: DeliveryContext): Promise<void>;
  nack?(deliveryId: string, error: ErrorObject, context: DeliveryContext): Promise<void>;
}

export interface SubscribeOptions {
  consumer_id: string;
  queue_name: string;
  max_attempts?: number;
}
