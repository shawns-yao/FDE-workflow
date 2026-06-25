import test from "node:test";
import assert from "node:assert/strict";
import { createFeishuConnectorFromEnv } from "../../../src/connectors/feishu/connector-factory.js";
import { OpenApiFeishuConnector } from "../../../src/connectors/feishu/openapi-feishu-connector.js";
import { WebhookFeishuConnector } from "../../../src/connectors/feishu/webhook-feishu-connector.js";

test("creates webhook connector from FEISHU_MODE", () => {
  const connector = createFeishuConnectorFromEnv({
    FEISHU_MODE: "webhook_bot",
    FEISHU_WEBHOOK_URL: "https://open.feishu.cn/webhook/test"
  });

  assert.equal(connector instanceof WebhookFeishuConnector, true);
});

test("creates openapi connector from FEISHU_MODE", () => {
  const connector = createFeishuConnectorFromEnv({
    FEISHU_MODE: "openapi_bot",
    FEISHU_APP_ID: "app-id",
    FEISHU_APP_SECRET: "app-secret"
  });

  assert.equal(connector instanceof OpenApiFeishuConnector, true);
});
