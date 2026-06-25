import type { Redis as RedisClient } from "ioredis";
import type { ErrorObject } from "../common/contracts.js";
import { createId } from "../common/ids.js";
import type { DeadLetterEventRecord } from "./archive.js";
import type { DeliveryContext, EventBroker, EventHandler, SubscribeOptions } from "./broker.js";
import type { CloudEvent } from "./cloudevent.js";
import type { EventType } from "./event-types.js";

export interface RedisStreamsEventBrokerOptions {
  streamName?: string;
  dlqStreamName?: string;
  blockMs?: number;
  batchSize?: number;
  pendingIdleMs?: number;
}

interface RedisStreamSubscription {
  handlers: RedisStreamHandlerRegistration[];
  options: SubscribeOptions;
  cursor: string;
  running: boolean;
}

interface RedisStreamHandlerRegistration {
  eventTypes: EventType[];
  handler: EventHandler;
}

export class RedisStreamsEventBroker implements EventBroker {
  private readonly streamName: string;
  private readonly dlqStreamName: string;
  private readonly blockMs: number;
  private readonly batchSize: number;
  private readonly pendingIdleMs: number;
  private readonly subscriptions: RedisStreamSubscription[] = [];

  constructor(
    private readonly redis: RedisClient,
    options: RedisStreamsEventBrokerOptions = {}
  ) {
    this.streamName = options.streamName ?? "fde.events";
    this.dlqStreamName = options.dlqStreamName ?? "fde.events.dlq";
    this.blockMs = options.blockMs ?? 5000;
    this.batchSize = options.batchSize ?? 10;
    this.pendingIdleMs = options.pendingIdleMs ?? 30000;
  }

  async publish<TData>(event: CloudEvent<TData>): Promise<void> {
    await this.redis.xadd(this.streamName, "*", "event", JSON.stringify(event), "type", event.type);
  }

  async subscribe<TData>(eventTypes: EventType[], handler: EventHandler<TData>, options: SubscribeOptions): Promise<void> {
    await this.ensureGroup(options.queue_name);
    const existingSubscription = this.subscriptions.find((subscription) =>
      subscription.running &&
      subscription.options.queue_name === options.queue_name &&
      subscription.options.consumer_id === options.consumer_id
    );
    if (existingSubscription) {
      existingSubscription.handlers.push({
        eventTypes,
        handler: handler as EventHandler
      });
      return;
    }

    const subscription: RedisStreamSubscription = {
      handlers: [
        {
          eventTypes,
          handler: handler as EventHandler
        }
      ],
      options,
      cursor: ">",
      running: true
    };
    this.subscriptions.push(subscription);
    void this.consume(subscription);
  }

  async publishDeadLetter<TData>(event: CloudEvent<TData>, error: ErrorObject, context: DeliveryContext): Promise<void> {
    const deadLetter: DeadLetterEventRecord<TData> = {
      event,
      consumer_id: context.consumer_id,
      queue_name: context.queue_name,
      failed_at: new Date().toISOString(),
      reason_code: error.code,
      error
    };
    await this.redis.xadd(
      this.dlqStreamName,
      "*",
      "dead_letter",
      JSON.stringify(deadLetter),
      "event_id",
      event.id,
      "consumer_id",
      context.consumer_id,
      "queue_name",
      context.queue_name,
      "type",
      event.type
    );
  }

  async ack(deliveryId: string, context: DeliveryContext): Promise<void> {
    if (!context.stream_id) {
      return;
    }
    await this.redis.xack(this.streamName, context.queue_name, context.stream_id);
    context.outcome = "acked";
  }

  async nack(deliveryId: string, error: ErrorObject, context: DeliveryContext): Promise<void> {
    const shouldRetry = context.attempt_count < context.max_attempts && error.retryable;

    if (shouldRetry) {
      // 重试：不 ack，等待 pending claim 重新处理
      context.outcome = "retry";
      return;
    }

    if (context.stream_id) {
      await this.redis.xack(this.streamName, context.queue_name, context.stream_id);
    }
    context.outcome = "dead_lettered";
  }

  async stop(): Promise<void> {
    for (const subscription of this.subscriptions) {
      subscription.running = false;
    }
  }

  private async ensureGroup(groupName: string): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", this.streamName, groupName, "0", "MKSTREAM");
    } catch (error) {
      if (error instanceof Error && error.message.includes("BUSYGROUP")) {
        return;
      }
      throw error;
    }
  }

  private async consume(subscription: RedisStreamSubscription): Promise<void> {
    while (subscription.running) {
      const response = await this.redis.xreadgroup(
        "GROUP",
        subscription.options.queue_name,
        subscription.options.consumer_id,
        "COUNT",
        this.batchSize,
        "BLOCK",
        this.blockMs,
        "STREAMS",
        this.streamName,
        subscription.cursor
      );

      if (!response) {
        await this.claimPending(subscription);
        continue;
      }

      for (const [, messages] of response as RedisStreamReadResponse) {
        for (const [streamId, fields] of messages) {
          const event = parseEvent(fields);
          if (!event) {
            await this.redis.xack(this.streamName, subscription.options.queue_name, streamId);
            continue;
          }
          const handlers = matchingHandlers(subscription, event);
          if (handlers.length === 0) {
            await this.redis.xack(this.streamName, subscription.options.queue_name, streamId);
            continue;
          }

          const context: DeliveryContext = {
            delivery_id: createId("delivery"),
            stream_id: streamId,
            consumer_id: subscription.options.consumer_id,
            queue_name: subscription.options.queue_name,
            attempt_count: 1,
            max_attempts: subscription.options.max_attempts ?? 3,
            received_at: new Date().toISOString(),
            trace_id: event.trace_id,
            correlation_id: event.correlation_id
          };

          for (const handler of handlers) {
            await handler(event, context);
            if (context.outcome === "retry" || context.outcome === "dead_lettered") {
              break;
            }
          }
          if (context.outcome === "acked" || context.outcome === "dead_lettered") {
            await this.redis.xack(this.streamName, subscription.options.queue_name, streamId);
          }
        }
      }
    }
  }

  private async claimPending(subscription: RedisStreamSubscription): Promise<void> {
    const pending = await this.redis.xpending(this.streamName, subscription.options.queue_name, "-", "+", this.batchSize);
    for (const item of pending as RedisPendingItem[]) {
      const [streamId, , idleMs, deliveries] = item;
      if (idleMs < this.pendingIdleMs) {
        continue;
      }
      const claimed = await this.redis.xclaim(
        this.streamName,
        subscription.options.queue_name,
        subscription.options.consumer_id,
        this.pendingIdleMs,
        streamId
      );
      for (const [claimedStreamId, fields] of claimed as Array<[string, string[]]>) {
        const event = parseEvent(fields);
        if (!event) {
          await this.redis.xack(this.streamName, subscription.options.queue_name, claimedStreamId);
          continue;
        }
        const handlers = matchingHandlers(subscription, event);
        if (handlers.length === 0) {
          await this.redis.xack(this.streamName, subscription.options.queue_name, claimedStreamId);
          continue;
        }
        const context: DeliveryContext = {
          delivery_id: createId("delivery"),
          stream_id: claimedStreamId,
          consumer_id: subscription.options.consumer_id,
          queue_name: subscription.options.queue_name,
          attempt_count: Math.max(1, deliveries),
          max_attempts: subscription.options.max_attempts ?? 3,
          received_at: new Date().toISOString(),
          trace_id: event.trace_id,
          correlation_id: event.correlation_id
        };
        for (const handler of handlers) {
          await handler(event, context);
          if (context.outcome === "retry" || context.outcome === "dead_lettered") {
            break;
          }
        }
        if (context.outcome === "acked" || context.outcome === "dead_lettered") {
          await this.redis.xack(this.streamName, subscription.options.queue_name, claimedStreamId);
        }
      }
    }
  }
}

type RedisStreamReadResponse = Array<[string, Array<[string, string[]]>]>;
type RedisPendingItem = [string, string, number, number];

function parseEvent(fields: string[]): CloudEvent | undefined {
  const eventIndex = fields.findIndex((field) => field === "event");
  if (eventIndex < 0 || eventIndex + 1 >= fields.length) {
    return undefined;
  }
  return JSON.parse(fields[eventIndex + 1]) as CloudEvent;
}

function matchingHandlers(subscription: RedisStreamSubscription, event: CloudEvent): EventHandler[] {
  return subscription.handlers
    .filter((registration) => registration.eventTypes.includes(event.type))
    .map((registration) => registration.handler);
}
