import test from "node:test";
import assert from "node:assert/strict";
import { verifyArgoCdWebhookToken, verifyGitLabWebhookToken, verifyTektonReportToken } from "../../src/events/ingress-auth.js";

test("verifies GitLab webhook token from x-gitlab-token header", () => {
  const result = verifyGitLabWebhookToken(
    {
      "x-gitlab-token": "expected"
    },
    "expected"
  );

  assert.equal(result.ok, true);
});

test("rejects GitLab webhook with invalid token", () => {
  const result = verifyGitLabWebhookToken(
    {
      "x-gitlab-token": "bad"
    },
    "expected"
  );

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "AUTHENTICATION_FAILED");
});

test("verifies ArgoCD webhook bearer token", () => {
  const result = verifyArgoCdWebhookToken(
    {
      authorization: "Bearer expected"
    },
    "expected"
  );

  assert.equal(result.ok, true);
});

test("verifies Tekton report token from x-fde-token header", () => {
  const result = verifyTektonReportToken(
    {
      "x-fde-token": "expected"
    },
    "expected"
  );

  assert.equal(result.ok, true);
});
