import test from "node:test";
import assert from "node:assert/strict";
import { loadComplianceRadarScheduleConfig } from "../../../src/radars/compliance/schedule-config.js";

test("loads scheduled radar config from cli arguments", () => {
  const config = loadComplianceRadarScheduleConfig([
    "--env",
    "test",
    "--mode",
    "full",
    "--targets",
    "gitlab,argocd",
    "--interval-ms",
    "60000",
    "--artifact-root",
    "tmp/radar"
  ]);

  assert.equal(config.request.trigger, "scheduled");
  assert.equal(config.request.environment, "test");
  assert.equal(config.request.mode, "full");
  assert.deepEqual(config.request.targets, ["gitlab", "argocd"]);
  assert.equal(config.interval_ms, 60000);
  assert.equal(config.artifact_root, "tmp/radar");
});

test("falls back to dev fast scan defaults when args are omitted", () => {
  const config = loadComplianceRadarScheduleConfig([]);

  assert.equal(config.request.environment, "dev");
  assert.equal(config.request.mode, "fast");
  assert.deepEqual(config.request.targets, ["gitlab", "tekton", "argocd", "kubernetes"]);
  assert.equal(config.interval_ms, 300000);
  assert.equal(config.artifact_root, ".");
});
