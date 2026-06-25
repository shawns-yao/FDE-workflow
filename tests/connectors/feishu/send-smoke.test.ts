import test from "node:test";
import assert from "node:assert/strict";
import { runFeishuOpenApiSmoke } from "../../../src/connectors/feishu/send-smoke.js";
import type { OpenApiFetch } from "../../../src/connectors/feishu/openapi-feishu-connector.js";

test("feishu openapi smoke reads credentials and target from env", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetch: OpenApiFetch = async (url, init) => {
    requests.push({
      url,
      body: JSON.parse(init.body ?? "{}") as Record<string, unknown>
    });
    if (url.includes("/auth/")) {
      return response({
        code: 0,
        tenant_access_token: "tenant-token"
      });
    }
    return response({
      code: 0,
      data: {
        message_id: "om_smoke"
      }
    });
  };

  const result = await runFeishuOpenApiSmoke({
    env: {
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret-value",
      FEISHU_TEST_CHAT_ID: "oc_test"
    },
    fetch,
    now: () => new Date("2026-06-18T00:00:00.000Z")
  });

  assert.equal(result.status, "sent");
  assert.equal(result.message_id, "om_smoke");
  assert.equal(requests[0].body["app_id"], "cli_test");
  assert.equal(requests[0].body["app_secret"], "secret-value");
  assert.equal(requests[1].url, "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id");
  assert.equal(requests[1].body["receive_id"], "oc_test");
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

test("feishu openapi smoke rejects missing env without leaking configured secrets", async () => {
  const result = await runFeishuOpenApiSmoke({
    env: {
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret-value"
    }
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "CONFIGURATION_INVALID");
  assert.equal(result.error?.retryable, false);
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

function response(body: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  };
}
