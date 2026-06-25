import test from "node:test";
import assert from "node:assert/strict";
import { OpenApiFeishuConnector } from "../../../src/connectors/feishu/openapi-feishu-connector.js";
import type { SendCardInput, UpdateCardInput } from "../../../src/connectors/feishu/types.js";

test("openapi connector sends interactive card using tenant access token", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const connector = createConnector(requests);

  const result = await connector.sendCard(cardInput);

  assert.equal(result.status, "sent");
  assert.equal(result.message_id, "om_msg_1");
  assert.equal(requests[0].url, "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal");
  assert.equal(requests[1].url, "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id");
  assert.equal(requests[1].headers.authorization, "Bearer tenant-token");
});

test("openapi connector maps user targets to open_id receive type", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const connector = createConnector(requests);

  const result = await connector.sendCard({
    ...cardInput,
    target_type: "user",
    target_id: "ou_user"
  });

  assert.equal(result.status, "sent");
  assert.equal(requests[1].url, "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id");
  assert.equal(requests[1].body.receive_id, "ou_user");
});

test("openapi connector maps group targets to chat_id receive type", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const connector = createConnector(requests);

  const result = await connector.sendCard({
    ...cardInput,
    target_type: "group",
    target_id: "oc_group"
  });

  assert.equal(result.status, "sent");
  assert.equal(requests[1].url, "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id");
  assert.equal(requests[1].body.receive_id, "oc_group");
});

test("openapi connector renders mentions and action buttons in interactive card", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const connector = createConnector(requests);

  const result = await connector.sendCard({
    ...cardInput,
    mentions: [
      { type: "user", id: "ou_user_1", reason: "owner" },
      { type: "user", id: "ou_user_2", reason: "reviewer" }
    ],
    actions: [
      { type: "open_url", label: "Open", url: "https://example.com" },
      { type: "acknowledge", label: "Ack", value: "startup_ack" }
    ]
  });

  const content = JSON.parse(String(requests[1].body.content)) as {
    elements: Array<{
      tag: string;
      text?: { content: string };
      actions?: Array<{
        tag: string;
        url?: string;
        value?: Record<string, unknown>;
      }>;
    }>;
  };

  assert.equal(result.status, "sent");
  assert.equal(content.elements[0].text?.content, "<at id=ou_user_1></at> <at id=ou_user_2></at>\nRoot cause summary");
  assert.equal(content.elements[1].tag, "action");
  assert.equal(content.elements[1].actions?.[0].url, "https://example.com");
  assert.deepEqual(content.elements[1].actions?.[1].value, {
    action_type: "acknowledge",
    value: "startup_ack"
  });
});

test("openapi connector updates existing card by message id", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const connector = createConnector(requests);

  await connector.updateCard(updateInput);

  assert.equal(requests[1].url, "https://open.feishu.cn/open-apis/im/v1/messages/om_msg_1");
  assert.equal(requests[1].headers.authorization, "Bearer tenant-token");
});

test("openapi connector replies to message", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const connector = createConnector(requests);

  const result = await connector.replyMessage({
    message_id: "om_msg_1",
    content: "已收到",
    correlation_id: "corr-test",
    trace_id: "trace-test",
    run_id: "run-test"
  });

  assert.equal(result.status, "sent");
  assert.equal(result.reply_to_message_id, "om_msg_1");
  assert.equal(result.message_id, "om_reply_1");
});

test("openapi connector maps failed openapi response details into error object", async () => {
  const connector = new OpenApiFeishuConnector({
    appId: "app-id",
    appSecret: "app-secret",
    fetch: async (url) => {
      if (url.includes("tenant_access_token")) {
        return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: "tenant-token" }) };
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({
          code: 99991663,
          msg: "bad receive id"
        })
      };
    }
  });

  const result = await connector.sendCard(cardInput);

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(result.error?.details?.["http_status"], 400);
  assert.equal(result.error?.details?.["feishu_code"], 99991663);
  assert.equal(result.error?.details?.["feishu_msg"], "bad receive id");
});

test("openapi connector lists chat members as open ids", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> | undefined; headers: Record<string, string> }> = [];
  const connector = new OpenApiFeishuConnector({
    appId: "app-id",
    appSecret: "app-secret",
    fetch: async (url, init) => {
      requests.push({
        url,
        body: init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
        headers: init.headers
      });
      if (url.includes("tenant_access_token")) {
        return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: "tenant-token" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            items: [
              { member_id: "ou_member_1", name: "User One" },
              { member_id: "ou_member_2", name: "User Two" }
            ]
          }
        })
      };
    }
  });

  const members = await connector.listChatMembers({ chat_id: "oc_chat", limit: 2 });

  assert.equal(requests[1].url, "https://open.feishu.cn/open-apis/im/v1/chats/oc_chat/members?member_id_type=open_id&page_size=2");
  assert.deepEqual(members, [
    { open_id: "ou_member_1", name: "User One" },
    { open_id: "ou_member_2", name: "User Two" }
  ]);
});

function createConnector(requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }>) {
  return new OpenApiFeishuConnector({
    appId: "app-id",
    appSecret: "app-secret",
    fetch: async (url, init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      requests.push({ url, body, headers: init.headers });
      if (url.includes("tenant_access_token")) {
        return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: "tenant-token" }) };
      }
      if (url.includes("/reply")) {
        return { ok: true, status: 200, json: async () => ({ code: 0, data: { message_id: "om_reply_1" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { message_id: "om_msg_1" } }) };
    },
    now: () => new Date("2026-06-17T00:00:00.000Z")
  });
}

const cardInput: SendCardInput = {
  mode: "openapi_bot",
  target_type: "chat",
  target_id: "oc_chat",
  card_type: "diagnosis_notification",
  title: "Diagnosis",
  summary: "Root cause summary",
  severity: "high",
  actions: [{ type: "claim", label: "Claim", value: "claim" }],
  data: { status: "failed" },
  correlation_id: "corr-test",
  trace_id: "trace-test",
  run_id: "run-test"
};

const updateInput: UpdateCardInput = {
  mode: "openapi_bot",
  message_id: "om_msg_1",
  card_type: "diagnosis_notification",
  title: "Diagnosis updated",
  summary: "Processing",
  severity: "medium",
  actions: [{ type: "mark_fixed", label: "Mark fixed", value: "fixed" }],
  data: { status: "processing" },
  correlation_id: "corr-test",
  trace_id: "trace-test",
  run_id: "run-test"
};
