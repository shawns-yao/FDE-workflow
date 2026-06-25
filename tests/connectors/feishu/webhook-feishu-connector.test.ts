import test from "node:test";
import assert from "node:assert/strict";
import { WebhookFeishuConnector } from "../../../src/connectors/feishu/webhook-feishu-connector.js";
import type { SendCardInput } from "../../../src/connectors/feishu/types.js";

test("webhook connector sends signed Feishu card payload", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const connector = new WebhookFeishuConnector({
    webhookUrl: "https://open.feishu.cn/webhook/test",
    webhookSecret: "secret",
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return { ok: true, status: 200, json: async () => ({ StatusCode: 0, msg: "ok" }) };
    },
    now: () => new Date("2026-06-17T00:00:00.000Z")
  });

  const result = await connector.sendCard(cardInput);

  assert.equal(result.status, "sent");
  assert.equal(requests[0].url, "https://open.feishu.cn/webhook/test");
  assert.equal(requests[0].body["msg_type"], "interactive");
  assert.equal(typeof requests[0].body["sign"], "string");
  assert.equal(requests[0].body["timestamp"], "1781654400");
});

test("webhook connector returns structured error when webhook is not configured", async () => {
  const connector = new WebhookFeishuConnector({ webhookUrl: "" });
  const result = await connector.sendCard(cardInput);

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "MODEL_NOT_CONFIGURED");
});

const cardInput: SendCardInput = {
  mode: "webhook_bot",
  target_type: "group",
  target_id: "default",
  card_type: "environment_scan_report",
  title: "Environment scan",
  summary: "GitLab warning",
  severity: "medium",
  actions: [{ type: "open_url", label: "Open", url: "https://example.com" }],
  data: { status: "warning" },
  correlation_id: "corr-test",
  trace_id: "trace-test",
  run_id: "run-test"
};
