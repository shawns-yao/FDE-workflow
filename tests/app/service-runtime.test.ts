import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createFdeServiceRuntime } from "../../src/app/service-runtime.js";
import type { IMConnectorService } from "../../src/connectors/feishu/connector.js";
import type { FeishuCallbackEvent, FeishuCallbackInput, MentionUserInput, MentionUserResult, ReplyMessageInput, ReplyMessageResult, SendCardInput, SendCardResult, UpdateCardInput } from "../../src/connectors/feishu/types.js";

test("fde service runtime wires feishu callback through project server", async () => {
  const runtime = createFdeServiceRuntime({
    env: {
      FDE_ENVIRONMENT: "dev",
      FDE_EVENT_BACKEND: "memory",
      FEISHU_CALLBACK_VERIFICATION_TOKEN: "expected"
    }
  });

  await listen(runtime.server);
  try {
    const response = await fetch(baseUrl(runtime.server) + "/webhook/feishu/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "url_verification",
        token: "expected",
        challenge: "challenge-value"
      })
    });
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body["challenge"], "challenge-value");
    assert.equal(runtime.environment, "dev");
    assert.equal(runtime.event_backend, "memory");
  } finally {
    await runtime.close();
  }
});

test("fde service runtime sends a text message through feishu connector", async () => {
  const connector = new CapturingFeishuConnector();
  const runtime = createFdeServiceRuntime({
    env: {
      FDE_ENVIRONMENT: "dev",
      FDE_EVENT_BACKEND: "memory",
      FEISHU_MODE: "openapi_bot",
      FEISHU_TEST_CHAT_ID: "oc_test"
    },
    feishuConnector: connector
  });

  const result = await runtime.sendFeishuTextMessage("FDE Workstation 服务启动测试消息");

  assert.equal(result.status, "sent");
  assert.equal(connector.cards.length, 1);
  assert.equal(connector.cards[0].mode, "openapi_bot");
  assert.equal(connector.cards[0].target_type, "chat");
  assert.equal(connector.cards[0].target_id, "oc_test");
  assert.equal(connector.cards[0].card_type, "custom");
  assert.equal(connector.cards[0].summary, "FDE Workstation 服务启动测试消息");
});

test("fde service runtime builds startup card mentions and actions from env", async () => {
  const connector = new CapturingFeishuConnector();
  const runtime = createFdeServiceRuntime({
    env: {
      FDE_ENVIRONMENT: "dev",
      FDE_EVENT_BACKEND: "memory",
      FEISHU_MODE: "openapi_bot",
      FEISHU_TEST_CHAT_ID: "oc_test",
      FEISHU_STARTUP_MENTION_OPEN_IDS: "ou_user_1, ou_user_2",
      FEISHU_STARTUP_ACTION_URL: "https://example.com",
      FEISHU_STARTUP_ACTION_LABEL: "Open",
      FEISHU_STARTUP_ENABLE_CALLBACK_ACTIONS: "true"
    },
    feishuConnector: connector
  });

  const result = await runtime.sendFeishuTextMessage("FDE Workstation 服务启动测试消息");

  assert.equal(result.status, "sent");
  assert.deepEqual(connector.cards[0].mentions, [
    { type: "user", id: "ou_user_1", reason: "startup_message" },
    { type: "user", id: "ou_user_2", reason: "startup_message" }
  ]);
  assert.deepEqual(connector.cards[0].actions, [
    { type: "open_url", label: "Open", url: "https://example.com" },
    { type: "acknowledge", label: "确认收到", value: "startup_acknowledge" }
  ]);
});

test("fde service runtime can resolve startup mentions from chat members", async () => {
  const connector = new CapturingFeishuConnector();
  connector.chatMembers = [
    { open_id: "ou_member_1", name: "User One" },
    { open_id: "ou_member_2", name: "User Two" }
  ];
  const runtime = createFdeServiceRuntime({
    env: {
      FDE_ENVIRONMENT: "dev",
      FDE_EVENT_BACKEND: "memory",
      FEISHU_MODE: "openapi_bot",
      FEISHU_TEST_CHAT_ID: "oc_test",
      FEISHU_STARTUP_MENTION_FROM_CHAT_MEMBERS: "true",
      FEISHU_STARTUP_MENTION_LIMIT: "1"
    },
    feishuConnector: connector
  });

  const result = await runtime.sendFeishuTextMessage("FDE Workstation 服务启动测试消息");

  assert.equal(result.status, "sent");
  assert.deepEqual(connector.chatMemberRequests, [{ chat_id: "oc_test", limit: 1 }]);
  assert.deepEqual(connector.cards[0].mentions, [
    { type: "user", id: "ou_member_1", reason: "startup_message" }
  ]);
});

test("fde service runtime returns structured error when startup mention resolution fails", async () => {
  const connector = new CapturingFeishuConnector();
  connector.chatMembersError = new Error("Feishu member permission denied");
  const runtime = createFdeServiceRuntime({
    env: {
      FDE_ENVIRONMENT: "dev",
      FDE_EVENT_BACKEND: "memory",
      FEISHU_MODE: "openapi_bot",
      FEISHU_TEST_CHAT_ID: "oc_test",
      FEISHU_STARTUP_MENTION_FROM_CHAT_MEMBERS: "true"
    },
    feishuConnector: connector
  });

  const result = await runtime.sendFeishuTextMessage("FDE Workstation 服务启动测试消息");

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(result.error?.details?.["stage"], "resolve_startup_mentions");
  assert.equal(connector.cards.length, 0);
});

function listen(server: ReturnType<typeof createFdeServiceRuntime>["server"]): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function baseUrl(server: ReturnType<typeof createFdeServiceRuntime>["server"]): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

class CapturingFeishuConnector implements IMConnectorService {
  readonly cards: SendCardInput[] = [];
  readonly chatMemberRequests: Array<{ chat_id: string; limit?: number }> = [];
  chatMembers: Array<{ open_id: string; name?: string }> = [];
  chatMembersError?: Error;

  async sendCard(input: SendCardInput): Promise<SendCardResult> {
    this.cards.push(input);
    return {
      status: "sent",
      message_id: "om_test",
      target_id: input.target_id,
      sent_at: "2026-06-18T00:00:00.000Z"
    };
  }

  async updateCard(_input: UpdateCardInput): Promise<void> {
    return;
  }

  async replyMessage(input: ReplyMessageInput): Promise<ReplyMessageResult> {
    return {
      status: "sent",
      message_id: "om_reply",
      reply_to_message_id: input.message_id,
      sent_at: "2026-06-18T00:00:00.000Z"
    };
  }

  mentionUser(input: MentionUserInput): MentionUserResult {
    return {
      type: "mention",
      user_id: input.user_id,
      fragment: {
        text: input.content
      }
    };
  }

  async handleCallback(input: FeishuCallbackInput): Promise<FeishuCallbackEvent> {
    return {
      type: "feishu.message.replied",
      message_id: String(input.raw["message_id"] ?? "unknown"),
      environment: input.environment,
      raw_callback_excerpt: JSON.stringify(input.raw).slice(0, 256),
      correlation_id: input.correlation_id,
      trace_id: input.trace_id,
      run_id: input.run_id
    };
  }

  async listChatMembers(input: { chat_id: string; limit?: number }): Promise<Array<{ open_id: string; name?: string }>> {
    this.chatMemberRequests.push(input);
    if (this.chatMembersError) {
      throw this.chatMembersError;
    }
    return this.chatMembers.slice(0, input.limit);
  }
}
