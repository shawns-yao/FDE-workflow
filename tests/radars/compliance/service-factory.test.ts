import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ErrorObject } from "../../../src/common/contracts.js";
import type { DeliveryContext, EventBroker, EventHandler, SubscribeOptions } from "../../../src/events/broker.js";
import type { CloudEvent } from "../../../src/events/cloudevent.js";
import type { EventType } from "../../../src/events/event-types.js";
import { createComplianceRadarRuntime } from "../../../src/radars/compliance/service-factory.js";

test("compliance radar runtime publishes scan events through injected event infrastructure", async () => {
  const artifactRoot = await mkdtemp(join(tmpdir(), "fde-radar-factory-"));
  const infrastructure = new FakeEventInfrastructure();
  const runtime = createComplianceRadarRuntime({
    artifactRoot,
    createEventInfrastructure: () => infrastructure,
    probes: []
  });

  try {
    const result = await runtime.service.scan({
      scan_id: "scan-factory",
      trigger: "manual",
      environment: "dev",
      mode: "fast",
      targets: ["gitlab"],
      required_layers: ["connectivity", "permission", "configuration"],
      correlation_id: "corr-factory",
      trace_id: "trace-factory",
      run_id: "run-factory"
    });

    assert.equal(result.scan_id, "scan-factory");
    assert.equal(infrastructure.broker.events.length, 1);
    assert.equal(infrastructure.broker.events[0].source, "compliance");
    assert.equal(infrastructure.broker.events[0].type, "compliance.environment.scan.completed");

    await runtime.close();

    assert.equal(infrastructure.closed, true);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

class FakeEventInfrastructure {
  readonly broker = new CapturingBroker();
  closed = false;

  async close(): Promise<void> {
    this.closed = true;
  }
}

class CapturingBroker implements EventBroker {
  readonly events: CloudEvent[] = [];

  async publish<TData>(event: CloudEvent<TData>): Promise<void> {
    this.events.push(event as CloudEvent);
  }

  async publishDeadLetter<TData>(_event: CloudEvent<TData>, _error: ErrorObject, _context: DeliveryContext): Promise<void> {
    return;
  }

  async subscribe<TData>(_eventTypes: EventType[], _handler: EventHandler<TData>, _options: SubscribeOptions): Promise<void> {
    return;
  }
}
