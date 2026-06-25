import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyFeishuCallback } from "../../../src/connectors/feishu/callback-security.js";

test("returns challenge for Feishu URL verification callback", () => {
  const result = verifyFeishuCallback({
    rawBody: JSON.stringify({ type: "url_verification", token: "verify-token", challenge: "challenge-value" }),
    headers: {},
    verificationToken: "verify-token"
  });

  assert.equal(result.ok, true);
  assert.equal(result.challenge, "challenge-value");
});

test("accepts signed Feishu callback with matching timestamp and signature", () => {
  const rawBody = JSON.stringify({ event: { message_id: "msg-1" } });
  const timestamp = "1780000000";
  const signingSecret = "signing-secret";
  const signature = sign(timestamp, rawBody, signingSecret);

  const result = verifyFeishuCallback({
    rawBody,
    headers: {
      "x-lark-request-timestamp": timestamp,
      "x-lark-signature": signature
    },
    signingSecret
  });

  assert.equal(result.ok, true);
});

test("rejects Feishu callback when signature is invalid", () => {
  const result = verifyFeishuCallback({
    rawBody: JSON.stringify({ event: { message_id: "msg-1" } }),
    headers: {
      "x-lark-request-timestamp": "1780000000",
      "x-lark-signature": "bad-signature"
    },
    signingSecret: "signing-secret"
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "AUTHENTICATION_FAILED");
});

function sign(timestamp: string, rawBody: string, secret: string): string {
  return createHmac("sha256", `${timestamp}\n${secret}`).update(rawBody).digest("base64");
}
