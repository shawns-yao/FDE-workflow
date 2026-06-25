import test from "node:test";
import assert from "node:assert/strict";
import { PipelineStateMachine } from "../../../src/agents/pipeline/state-machine.js";
import { eventTypes } from "../../../src/events/event-types.js";

test("pipeline state machine only emits event types defined by event bus contract", () => {
  const machine = new PipelineStateMachine();
  const task = machine.createTask("build-1", "checkout", "dev", "v1", "abc123", "pr-1", "webhook");

  const results = [
    machine.startUpdating(task.task_id),
    machine.startSyncing(task.task_id),
    machine.complete(task.task_id)
  ];

  for (const result of results) {
    assert.equal(eventTypes.includes(result.event), true, `${result.event} must be in 01 event list`);
  }
});

test("pipeline state machine emits deployment failed for failed delivery path", () => {
  const machine = new PipelineStateMachine();
  const task = machine.createTask("build-2", "checkout", "dev", "v1", "abc123", "pr-2", "webhook");
  machine.startUpdating(task.task_id);

  const result = machine.fail(task.task_id, "git push failed");

  assert.equal(result.event, "pipeline.deployment.failed");
});
