import test from "node:test";
import assert from "node:assert/strict";
import { ComplianceRadarScheduler } from "../../../src/radars/compliance/scheduler.js";
import type { EnvironmentScanRequest, EnvironmentScanResult } from "../../../src/radars/compliance/types.js";

test("scheduler triggers compliance scan with configured request", async () => {
  const service = new CapturingRadarService();
  const scheduler = new ComplianceRadarScheduler({
    service,
    request: baseRequest,
    interval_ms: 1000,
    timer: immediateTimer
  });

  scheduler.start();

  assert.equal(service.requests.length, 1);
  assert.equal(service.requests[0].scan_id, "scan-scheduled");
  scheduler.stop();
});

test("scheduler can create a fresh request for every tick", async () => {
  const service = new CapturingRadarService();
  const timer = new CapturingTimer();
  let index = 0;
  const scheduler = new ComplianceRadarScheduler({
    service,
    request: () => ({
      ...baseRequest,
      scan_id: `scan-${++index}`
    }),
    interval_ms: 1000,
    timer
  });

  scheduler.start();
  timer.tick();
  timer.tick();

  assert.deepEqual(
    service.requests.map((request) => request.scan_id),
    ["scan-1", "scan-2"]
  );
  scheduler.stop();
}
);

class CapturingRadarService {
  readonly requests: EnvironmentScanRequest[] = [];

  async scan(request: EnvironmentScanRequest): Promise<EnvironmentScanResult> {
    this.requests.push(request);
    return {
      scan_id: request.scan_id,
      environment: request.environment,
      trigger: request.trigger,
      mode: request.mode,
      overall_status: "healthy",
      started_at: "2026-06-17T00:00:00.000Z",
      finished_at: "2026-06-17T00:00:00.000Z",
      targets: [],
      artifact_refs: [],
      metadata: { pending_checks: [] }
    };
  }
}

const immediateTimer = {
  setInterval(callback: () => void, _intervalMs: number) {
    callback();
    return 1;
  },
  clearInterval(_handle: unknown) {
    return;
  }
};

class CapturingTimer {
  private callback?: () => void;

  setInterval(callback: () => void, _intervalMs: number) {
    this.callback = callback;
    return 1;
  }

  clearInterval(_handle: unknown) {
    this.callback = undefined;
  }

  tick(): void {
    this.callback?.();
  }
}

const baseRequest: EnvironmentScanRequest = {
  scan_id: "scan-scheduled",
  trigger: "scheduled",
  environment: "dev",
  mode: "fast",
  targets: ["gitlab"],
  required_layers: ["connectivity", "permission", "configuration"],
  correlation_id: "corr-test",
  trace_id: "trace-test",
  run_id: "run-test"
};
