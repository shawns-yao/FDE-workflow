import type { ErrorObject } from "../common/contracts.js";
import type { DeliveryContext, EventBroker } from "./broker.js";
import { normalizeEvent } from "./normalizer.js";
import { createRedisEventInfrastructure } from "./redis-event-infrastructure.js";

export interface RedisSmokeInfrastructure {
  config: {
    streamName: string;
  };
  broker: EventBroker;
  close(): Promise<void>;
}

export interface RedisStreamsSmokeOptions {
  createInfrastructure?: () => RedisSmokeInfrastructure;
  timeoutMs?: number;
}

export interface RedisStreamsSmokeResult {
  ok: boolean;
  stream_name: string;
  queue_name: string;
  event_type: "gitlab.mr.updated";
  published_event_id?: string;
  received_event_id?: string;
  error?: ErrorObject;
}

const queueName = "agent.redis-smoke";
const consumerId = "redis-smoke-consumer";
const eventType = "gitlab.mr.updated";

export async function runRedisStreamsSmoke(options: RedisStreamsSmokeOptions = {}): Promise<RedisStreamsSmokeResult> {
  const infrastructure = options.createInfrastructure?.() ?? createRedisEventInfrastructure();
  const timeoutMs = options.timeoutMs ?? 5000;
  const event = normalizeEvent({
    source: "gitlab",
    type: eventType,
    subject: "redis-smoke/mr/1",
    application: "redis-smoke",
    environment: "dev",
    adapter_version: "redis-smoke-v1",
    data: {
      project_id: "redis-smoke",
      merge_request_iid: "1"
    }
  });

  try {
    let resolveReceived!: (eventId: string) => void;
    const received = new Promise<string>((resolve) => {
      resolveReceived = resolve;
    });

    await infrastructure.broker.subscribe(
      [eventType],
      async (deliveredEvent, context: DeliveryContext) => {
        context.outcome = "acked";
        resolveReceived(deliveredEvent.id);
      },
      {
        queue_name: queueName,
        consumer_id: consumerId,
        max_attempts: 1
      }
    );

    await infrastructure.broker.publish(event);
    const receivedEventId = await withTimeout(received, timeoutMs);

    return {
      ok: true,
      stream_name: infrastructure.config.streamName,
      queue_name: queueName,
      event_type: eventType,
      published_event_id: event.id,
      received_event_id: receivedEventId
    };
  } catch (error) {
    return {
      ok: false,
      stream_name: infrastructure.config.streamName,
      queue_name: queueName,
      event_type: eventType,
      published_event_id: event.id,
      error: toSmokeError(error)
    };
  } finally {
    await infrastructure.close();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Redis Streams smoke timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function toSmokeError(error: unknown): ErrorObject {
  return {
    code: "UPSTREAM_UNAVAILABLE",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    severity: "error",
    details: {}
  };
}
