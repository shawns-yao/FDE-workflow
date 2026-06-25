import test from "node:test";
import assert from "node:assert/strict";
import type { ErrorObject } from "../../src/common/contracts.js";
import type { DeliveryContext, EventBroker, EventHandler, SubscribeOptions } from "../../src/events/broker.js";
import type { CloudEvent } from "../../src/events/cloudevent.js";
import type { EventType } from "../../src/events/event-types.js";
import { runRedisStreamsSmoke, type RedisSmokeInfrastructure } from "../../src/events/redis-streams-smoke.js";

test("redis streams smoke publishes and receives one normalized event", async () => {
  const infrastructure = new FakeRedisSmokeInfrastructure();

  const result = await runRedisStreamsSmoke({
    createInfrastructure: () => infrastructure,
    timeoutMs: 100
  });

  assert.equal(result.ok, true);
  assert.equal(result.event_type, "gitlab.mr.updated");
  assert.equal(result.stream_name, "fde.test.events");
  assert.equal(result.queue_name, "agent.redis-smoke");
  assert.equal(result.received_event_id, result.published_event_id);
  assert.equal(infrastructure.closed, true);
});

class FakeRedisSmokeInfrastructure implements RedisSmokeInfrastructure {
  readonly config = {
    streamName: "fde.test.events"
  };
  readonly broker = new FakeBroker();
  closed = false;

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeBroker implements EventBroker {
  private handler?: EventHandler;
  private eventTypes: EventType[] = [];
  private options?: SubscribeOptions;

  async publish<TData>(event: CloudEvent<TData>): Promise<void> {
    if (!this.handler || !this.eventTypes.includes(event.type)) {
      return;
    }
    const context: DeliveryContext = {
      delivery_id: "delivery-smoke",
      consumer_id: this.options?.consumer_id ?? "consumer",
      queue_name: this.options?.queue_name ?? "queue",
      attempt_count: 1,
      max_attempts: 1,
      received_at: "2026-06-17T00:00:00.000Z",
      trace_id: event.trace_id,
      correlation_id: event.correlation_id
    };
    await this.handler(event, context);
  }

  async publishDeadLetter<TData>(_event: CloudEvent<TData>, _error: ErrorObject, _context: DeliveryContext): Promise<void> {
    return;
  }

  async subscribe<TData>(eventTypes: EventType[], handler: EventHandler<TData>, options: SubscribeOptions): Promise<void> {
    this.eventTypes = eventTypes;
    this.handler = handler as EventHandler;
    this.options = options;
  }
}
