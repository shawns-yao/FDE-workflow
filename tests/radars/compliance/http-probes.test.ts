import test from "node:test";
import assert from "node:assert/strict";
import { createGitLabProbe } from "../../../src/radars/compliance/http-probes.js";
import type { EnvironmentScanRequest } from "../../../src/radars/compliance/types.js";

test("GitLab probe returns critical when endpoint or token is missing", async () => {
  const probe = createGitLabProbe({
    baseUrl: "",
    token: "",
    fetch: async () => ({ ok: true, status: 200 })
  });

  const result = await probe.run(request);

  assert.equal(result.name, "gitlab");
  assert.equal(result.status, "critical");
  assert.equal(result.checks[0].error?.code, "AUTHENTICATION_FAILED");
});

test("GitLab probe returns healthy when version API is reachable", async () => {
  const probe = createGitLabProbe({
    baseUrl: "https://gitlab.example.com",
    token: "token",
    fetch: async (url, init) => {
      assert.equal(url, "https://gitlab.example.com/api/v4/version");
      assert.equal(init.headers["PRIVATE-TOKEN"], "token");
      return { ok: true, status: 200 };
    }
  });

  const result = await probe.run(request);

  assert.equal(result.status, "healthy");
  assert.equal(result.checks[0].status, "healthy");
});

const request: EnvironmentScanRequest = {
  scan_id: "scan-test",
  trigger: "manual",
  environment: "dev",
  mode: "full",
  targets: ["gitlab"],
  required_layers: ["connectivity", "permission", "configuration"],
  correlation_id: "corr-test",
  trace_id: "trace-test",
  run_id: "run-test"
};
