import test from "node:test";
import assert from "node:assert/strict";
import { MemoryEventArchiveRepository } from "../../src/events/archive.js";
import type { DeliveryContext, EventBroker, EventHandler, SubscribeOptions } from "../../src/events/broker.js";
import type { CloudEvent } from "../../src/events/cloudevent.js";
import { EventSubscriber } from "../../src/events/event-subscriber.js";
import type { EventType } from "../../src/events/event-types.js";
import { MemoryIdempotencyStore } from "../../src/events/idempotency-store.js";

const event: CloudEvent<Record<string, unknown>> = {
  specversion: "1.0",
  id: "evt-test",
  source: "gitlab",
  type: "gitlab.mr.updated",
  subject: "repo/app!1",
  time: "2026-06-17T00:00:00.000Z",
  datacontenttype: "application/json",
  correlation_id: "corr-test",
  trace_id: "trace-test",
  run_id: "run-test",
  application: "app",
  environment: "dev",
  data: {}
};

test("subscriber retries processing state instead of treating it as consumed", async () => {
  const broker = new CapturingBroker();
  const archive = new MemoryEventArchiveRepository();
  const subscriber = new EventSubscriber(broker, new MemoryIdempotencyStore(), archive);
  let attempts = 0;

  await subscriber.subscribe(
    ["gitlab.mr.updated"],
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary failure");
      }
    },
    { consumer_id: "consumer-a", queue_name: "agent.pipeline", max_attempts: 2 }
  );

  await broker.deliver(event, 1);
  await broker.deliver(event, 2);

  assert.equal(attempts, 2);
  assert.equal(broker.deadLetters.length, 0);
  assert.equal(archive.deliveries.at(-1)?.status, "processed");
});

test("subscriber publishes stable dead letter record after retry exhaustion", async () => {
  const broker = new CapturingBroker();
  const archive = new MemoryEventArchiveRepository();
  const subscriber = new EventSubscriber(broker, new MemoryIdempotencyStore(), archive);

  await subscriber.subscribe(
    ["gitlab.mr.updated"],
    async () => {
      throw new Error("permanent failure");
    },
    { consumer_id: "consumer-b", queue_name: "agent.pipeline", max_attempts: 1 }
  );

  await broker.deliver(event, 1);

  assert.equal(broker.deadLetters.length, 1);
  assert.equal(broker.deadLetters[0].event.id, event.id);
  assert.equal(broker.deadLetters[0].context.consumer_id, "consumer-b");
  assert.equal(archive.deadLetters.length, 1);
  assert.equal(archive.deadLetters[0].event.id, event.id);
  assert.equal(archive.deadLetters[0].queue_name, "agent.pipeline");
});

test("subscriber preserves structured ErrorObject from handler failures", async () => {
  const broker = new CapturingBroker();
  const archive = new MemoryEventArchiveRepository();
  const subscriber = new EventSubscriber(broker, new MemoryIdempotencyStore(), archive);

  await subscriber.subscribe(
    ["gitlab.mr.updated"],
    async () => {
      throw {
        code: "PERMISSION_DENIED",
        message: "token scope is insufficient",
        retryable: false,
        severity: "error",
        details: {
          system: "gitlab"
        }
      };
    },
    { consumer_id: "consumer-c", queue_name: "agent.pipeline", max_attempts: 3 }
  );

  await broker.deliver(event, 1);

  assert.equal(broker.deadLetters.length, 1);
  const deadLetterError = broker.deadLetters[0].error as { code?: string; details?: unknown };
  assert.equal(deadLetterError.code, "PERMISSION_DENIED");
  assert.equal(archive.deliveries.at(-1)?.error?.code, "PERMISSION_DENIED");
  assert.deepEqual(deadLetterError.details, { system: "gitlab" });
});

class CapturingBroker implements EventBroker {
  private handler?: EventHandler;
  private options?: SubscribeOptions;
  readonly deadLetters: Array<{ event: CloudEvent; error: unknown; context: DeliveryContext }> = [];

  async publish<TData>(_event: CloudEvent<TData>): Promise<void> {
    return;
  }

  async subscribe<TData>(eventTypes: EventType[], handler: EventHandler<TData>, options: SubscribeOptions): Promise<void> {
    assert.deepEqual(eventTypes, ["gitlab.mr.updated"]);
    this.handler = handler as EventHandler;
    this.options = options;
  }

  async publishDeadLetter<TData>(event: CloudEvent<TData>, error: unknown, context: DeliveryContext): Promise<void> {
    this.deadLetters.push({ event: event as CloudEvent, error, context });
  }

  async deliver(deliveredEvent: CloudEvent, attemptCount: number): Promise<DeliveryContext> {
    assert.ok(this.handler);
    assert.ok(this.options);
    const context: DeliveryContext = {
      delivery_id: `delivery-${attemptCount}`,
      consumer_id: this.options.consumer_id,
      queue_name: this.options.queue_name,
      attempt_count: attemptCount,
      max_attempts: this.options.max_attempts ?? 3,
      received_at: "2026-06-17T00:00:00.000Z",
      trace_id: deliveredEvent.trace_id,
      correlation_id: deliveredEvent.correlation_id
    };
    await this.handler(deliveredEvent, context);
    return context;
  }
}
