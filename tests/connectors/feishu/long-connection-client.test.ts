import test from "node:test";
import assert from "node:assert/strict";
import { MemoryEventArchiveRepository } from "../../../src/events/archive.js";
import { EventPublisherService } from "../../../src/events/event-publisher.js";
import { MemoryEventBroker } from "../../../src/events/memory-event-broker.js";
import {
  createFeishuLongConnectionIngressLog,
  normalizeFeishuCardActionEvent,
  normalizeFeishuMessageReceiveEvent,
  publishFeishuLongConnectionEvent
} from "../../../src/connectors/feishu/long-connection-client.js";

test("normalizes Feishu message receive event into connector callback event", () => {
  const callback = normalizeFeishuMessageReceiveEvent(
    {
      event_id: "evt-feishu-message",
      sender: {
        sender_id: {
          open_id: "ou_sender"
        },
        sender_type: "user"
      },
      message: {
        message_id: "om_message",
        chat_id: "oc_chat",
        chat_type: "group",
        message_type: "text",
        content: "{\"text\":\"build status\"}",
        create_time: "1781654400000"
      }
    },
    {
      environment: "dev",
      correlation_id: "corr-test",
      trace_id: "trace-test",
      run_id: "run-test"
    }
  );

  assert.equal(callback.type, "feishu.message.replied");
  assert.equal(callback.message_id, "om_message");
  assert.equal(callback.operator, "ou_sender");
  assert.equal(callback.correlation_id, "corr-test");
  assert.match(callback.raw_callback_excerpt, /build status/);
});

test("normalizes Feishu card action event into connector callback event", () => {
  const callback = normalizeFeishuCardActionEvent(
    {
      context: {
        open_message_id: "om_card",
        open_chat_id: "oc_chat"
      },
      operator: {
        open_id: "ou_operator"
      },
      action: {
        tag: "button",
        name: "ack",
        value: {
          action_type: "acknowledge",
          value: "startup_acknowledge"
        }
      },
      token: "should-be-redacted"
    },
    {
      environment: "dev",
      correlation_id: "corr-test",
      trace_id: "trace-test",
      run_id: "run-test"
    }
  );

  assert.equal(callback.type, "feishu.card.action_clicked");
  assert.equal(callback.message_id, "om_card");
  assert.equal(callback.operator, "ou_operator");
  assert.deepEqual(callback.action, {
    type: "acknowledge",
    label: "ack",
    value: "startup_acknowledge"
  });
  assert.match(callback.raw_callback_excerpt, /REDACTED/);
  assert.doesNotMatch(callback.raw_callback_excerpt, /should-be-redacted/);
});

test("creates redacted ingress log for Feishu message events", () => {
  const raw = {
    event_id: "evt-feishu-message",
    token: "should-not-leak",
    sender: {
      sender_id: {
        open_id: "ou_sender"
      }
    },
    message: {
      message_id: "om_message",
      chat_id: "oc_chat",
      content: "{\"text\":\"secret build status\"}"
    }
  };
  const callback = normalizeFeishuMessageReceiveEvent(raw, {
    environment: "dev",
    correlation_id: "corr-test",
    trace_id: "trace-test",
    run_id: "run-test"
  });

  const log = createFeishuLongConnectionIngressLog("im.message.receive_v1", raw, callback);

  assert.equal(log.status, "feishu_event_ingress_received");
  assert.equal(log.feishu_event_type, "im.message.receive_v1");
  assert.equal(log.cloud_event_type, "feishu.message.replied");
  assert.equal(log.message_id, "om_message");
  assert.equal(log.chat_id, "oc_chat");
  assert.equal(log.operator_present, true);
  assert.doesNotMatch(JSON.stringify(log), /secret build status|should-not-leak|ou_sender/);
});

test("publishes normalized long connection events into the event bus", async () => {
  const archive = new MemoryEventArchiveRepository();
  const publisher = new EventPublisherService(new MemoryEventBroker(), archive);

  const result = await publishFeishuLongConnectionEvent(
    publisher,
    normalizeFeishuCardActionEvent(
      {
        open_message_id: "om_card",
        operator: {
          open_id: "ou_operator"
        },
        action: {
          value: {
            action_type: "claim",
            value: "owner"
          }
        }
      },
      {
        environment: "dev",
        correlation_id: "corr-test",
        trace_id: "trace-test",
        run_id: "run-test"
      }
    )
  );

  assert.equal(result.published, true);
  assert.equal(archive.events.length, 1);
  assert.equal(archive.events[0].event.type, "feishu.card.action_clicked");
  assert.equal(archive.events[0].event.correlation_id, "corr-test");
});
