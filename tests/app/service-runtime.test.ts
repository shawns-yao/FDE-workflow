import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { ArtifactRef } from "../../src/common/contracts.js";
import type { ArtifactStore, ArtifactWriteInput } from "../../src/common/artifact-store.js";
import { createFdeServiceRuntime } from "../../src/app/service-runtime.js";
import type { IMConnectorService } from "../../src/connectors/feishu/connector.js";
import type { FeishuCallbackEvent, FeishuCallbackInput, MentionUserInput, MentionUserResult, ReplyMessageInput, ReplyMessageResult, SendCardInput, SendCardResult, UpdateCardInput } from "../../src/connectors/feishu/types.js";
import type { CloudEvent } from "../../src/events/cloudevent.js";
import { MemoryEventBroker } from "../../src/events/memory-event-broker.js";
import { loadZhMessages } from "../../src/i18n/messages.js";

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
  const messages = loadZhMessages();
  const runtime = createFdeServiceRuntime({
    env: {
      FDE_ENVIRONMENT: "dev",
      FDE_EVENT_BACKEND: "memory",
      FEISHU_MODE: "openapi_bot",
      FEISHU_TEST_CHAT_ID: "oc_test"
    },
    feishuConnector: connector
  });

  const result = await runtime.sendFeishuTextMessage();

  assert.equal(result.status, "sent");
  assert.equal(connector.cards.length, 1);
  assert.equal(connector.cards[0].mode, "openapi_bot");
  assert.equal(connector.cards[0].target_type, "chat");
  assert.equal(connector.cards[0].target_id, "oc_test");
  assert.equal(connector.cards[0].card_type, "custom");
  assert.equal(connector.cards[0].summary, messages.feishu.startup.deployment_test);
});

test("fde service runtime builds startup card mentions from env and actions from messages", async () => {
  const connector = new CapturingFeishuConnector();
  const messages = loadZhMessages();
  const runtime = createFdeServiceRuntime({
    env: {
      FDE_ENVIRONMENT: "dev",
      FDE_EVENT_BACKEND: "memory",
      FEISHU_MODE: "openapi_bot",
      FEISHU_TEST_CHAT_ID: "oc_test",
      FEISHU_STARTUP_MENTION_OPEN_IDS: "ou_user_1, ou_user_2",
      FEISHU_STARTUP_ACTION_URL: "https://example.com",
      FEISHU_STARTUP_ENABLE_CALLBACK_ACTIONS: "true"
    },
    feishuConnector: connector
  });

  const result = await runtime.sendFeishuTextMessage();

  assert.equal(result.status, "sent");
  assert.deepEqual(connector.cards[0].mentions, [
    { type: "user", id: "ou_user_1", reason: "startup_message" },
    { type: "user", id: "ou_user_2", reason: "startup_message" }
  ]);
  assert.deepEqual(connector.cards[0].actions, [
    { type: "open_url", label: messages.feishu.startup.open_url_label, url: "https://example.com" },
    { type: "acknowledge", label: messages.feishu.startup.acknowledge_label, value: "startup_acknowledge" }
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

  const result = await runtime.sendFeishuTextMessage();

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

  const result = await runtime.sendFeishuTextMessage();

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(result.error?.details?.["stage"], "resolve_startup_mentions");
  assert.equal(connector.cards.length, 0);
});

test("fde service runtime starts and closes Feishu long connection client", async () => {
  const connector = new CapturingFeishuConnector();
  const longConnection = new CapturingFeishuLongConnection();
  const runtime = createFdeServiceRuntime({
    env: {
      FDE_ENVIRONMENT: "dev",
      FDE_EVENT_BACKEND: "memory",
      FEISHU_MODE: "openapi_bot",
      FEISHU_EVENT_MODE: "websocket",
      FEISHU_APP_ID: "cli_xxx",
      FEISHU_APP_SECRET: "secret",
      FEISHU_TEST_CHAT_ID: "oc_test"
    },
    feishuConnector: connector,
    feishuLongConnection: longConnection
  });

  await runtime.startFeishuEventIngress();
  await runtime.close();

  assert.equal(runtime.feishu_event_mode, "websocket");
  assert.equal(longConnection.started, 1);
  assert.equal(longConnection.closed, 1);
});

test("fde service runtime wires collaboration acknowledge consumer", async () => {
  const broker = new MemoryEventBroker();
  const connector = new CapturingFeishuConnector();
  const runtime = createFdeServiceRuntime({
    env: {
      FDE_ENVIRONMENT: "dev",
      FDE_EVENT_BACKEND: "memory",
      FEISHU_MODE: "openapi_bot",
      FEISHU_EVENT_MODE: "disabled",
      FEISHU_TEST_CHAT_ID: "oc_test"
    },
    broker,
    feishuConnector: connector
  });

  await runtime.startFeishuEventIngress();
  await broker.publish(feishuActionEvent());

  assert.equal(connector.updates.length, 1);
  assert.equal(connector.updates[0].message_id, "om_runtime_ack_001");
  assert.equal(connector.updates[0].data["status"], "acknowledged");
});

test("fde service runtime wires collaboration escalation default target from env", async () => {
  const broker = new MemoryEventBroker();
  const connector = new CapturingFeishuConnector();
  const runtime = createFdeServiceRuntime({
    env: {
      FDE_ENVIRONMENT: "dev",
      FDE_EVENT_BACKEND: "memory",
      FEISHU_MODE: "openapi_bot",
      FEISHU_EVENT_MODE: "disabled",
      FEISHU_TEST_CHAT_ID: "oc_test",
      FEISHU_ESCALATION_TARGET_TYPE: "chat",
      FEISHU_ESCALATION_TARGET_ID: "oc_default_escalation"
    },
    broker,
    feishuConnector: connector
  });

  await runtime.startFeishuEventIngress();
  await broker.publish(collaborationEscalationEventWithoutTarget());

  assert.equal(connector.cards.length, 1);
  assert.equal(connector.cards[0].target_type, "chat");
  assert.equal(connector.cards[0].target_id, "oc_default_escalation");
  assert.equal(connector.cards[0].card_type, "escalation_notice");
});

test("fde service runtime wires collaboration progress artifact store from env", async () => {
  const broker = new MemoryEventBroker();
  const connector = new CapturingFeishuConnector();
  const artifactStore = new CapturingArtifactStore();
  const runtime = createFdeServiceRuntime({
    env: {
      FDE_ENVIRONMENT: "dev",
      FDE_EVENT_BACKEND: "memory",
      FEISHU_MODE: "openapi_bot",
      FEISHU_EVENT_MODE: "disabled",
      FEISHU_TEST_CHAT_ID: "oc_test",
      FDE_COLLABORATION_PROGRESS_ARTIFACTS_ENABLED: "true"
    },
    broker,
    feishuConnector: connector,
    artifactStore
  });

  await runtime.startFeishuEventIngress();
  await broker.publish(collaborationNotificationSentEvent());

  assert.equal(artifactStore.writes.length, 1);
  assert.equal(artifactStore.writes[0].artifact_type, "progress_record");
  assert.equal(artifactStore.writes[0].artifact_uri, "artifacts/collaboration/ntf-runtime-sent-001/progress-record.json");
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
  readonly updates: UpdateCardInput[] = [];
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

  async updateCard(input: UpdateCardInput): Promise<void> {
    this.updates.push(input);
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

class CapturingFeishuLongConnection {
  started = 0;
  closed = 0;

  async start(): Promise<void> {
    this.started += 1;
  }

  async close(): Promise<void> {
    this.closed += 1;
  }
}

class CapturingArtifactStore implements ArtifactStore {
  readonly writes: ArtifactWriteInput[] = [];

  async write(input: ArtifactWriteInput): Promise<ArtifactRef> {
    this.writes.push(input);
    return {
      artifact_id: "artifact-runtime-progress-001",
      artifact_uri: input.artifact_uri ?? "artifacts/runs/unscoped/progress-record.json",
      artifact_type: input.artifact_type,
      content_type: input.content_type,
      sha256: "sha256",
      size_bytes: 1,
      created_at: "2026-06-27T00:00:00.000Z"
    };
  }

  async read(): Promise<Buffer> {
    return Buffer.from("");
  }
}

function feishuActionEvent(): CloudEvent<FeishuCallbackEvent> {
  return {
    specversion: "1.0",
    id: "evt-runtime-action-001",
    source: "feishu",
    type: "feishu.card.action_clicked",
    subject: "feishu/om_runtime_ack_001",
    time: "2026-06-27T00:00:00.000Z",
    datacontenttype: "application/json",
    correlation_id: "corr-runtime-ack-001",
    trace_id: "trace-runtime-ack-001",
    run_id: "run-runtime-ack-001",
    application: "fde-workstation",
    environment: "dev",
    data: {
      type: "feishu.card.action_clicked",
      message_id: "om_runtime_ack_001",
      environment: "dev",
      action: {
        type: "acknowledge",
        label: "Acknowledge",
        value: "startup_acknowledge"
      },
      operator: "ou_runtime_user_001",
      raw_callback_excerpt: "{}",
      correlation_id: "corr-runtime-ack-001",
      trace_id: "trace-runtime-ack-001",
      run_id: "run-runtime-ack-001"
    }
  };
}

function collaborationNotificationSentEvent(): CloudEvent<Record<string, unknown>> {
  return {
    specversion: "1.0",
    id: "evt-runtime-notification-sent-001",
    source: "collaboration",
    type: "collaboration.notification.sent",
    subject: "notification/ntf-runtime-sent-001",
    time: "2026-06-27T04:20:00.000Z",
    datacontenttype: "application/json",
    correlation_id: "corr-runtime-sent-001",
    trace_id: "trace-runtime-sent-001",
    run_id: "run-runtime-sent-001",
    application: "fde-workstation",
    environment: "dev",
    data: {
      notification_id: "ntf-runtime-sent-001",
      status: "sent",
      message_id: "om_runtime_sent_001",
      target_id: "oc_target",
      sent_at: "2026-06-27T04:20:00.000Z"
    }
  };
}

function collaborationEscalationEventWithoutTarget(): CloudEvent<Record<string, unknown>> {
  return {
    specversion: "1.0",
    id: "evt-runtime-escalation-001",
    source: "collaboration",
    type: "collaboration.escalation.triggered",
    subject: "notification/ntf-runtime-timeout-001/escalation",
    time: "2026-06-27T05:00:00.000Z",
    datacontenttype: "application/json",
    correlation_id: "corr-runtime-escalation-001",
    trace_id: "trace-runtime-escalation-001",
    run_id: "run-runtime-escalation-001",
    application: "fde-workstation",
    environment: "dev",
    data: {
      notification_id: "ntf-runtime-timeout-001",
      message_id: "om_runtime_timeout_001",
      diagnosis_id: "diag-runtime-timeout-001",
      status: "needs_escalation",
      reason_code: "notification_timeout",
      reason: "no_response",
      triggered_at: "2026-06-27T05:00:00.000Z"
    }
  };
}
