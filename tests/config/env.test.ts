import test from "node:test";
import assert from "node:assert/strict";
import { loadFdeRuntimeConfig, FdeRuntimeConfigError } from "../../src/config/env.js";

test("loadFdeRuntimeConfig rejects prod startup when required secrets are missing", () => {
  assert.throws(
    () => loadFdeRuntimeConfig({
      FDE_ENVIRONMENT: "prod",
      FDE_EVENT_BACKEND: "redis",
      FDE_HTTP_PORT: "3412",
      REDIS_URL: "redis://redis:6379/0",
      FEISHU_MODE: "openapi_bot"
    }),
    (error: unknown) => {
      assert.ok(error instanceof FdeRuntimeConfigError);
      assert.equal(error.error.code, "CONFIGURATION_INVALID");
      assert.deepEqual(error.error.details?.["missing_keys"], [
        "FEISHU_APP_ID",
        "FEISHU_APP_SECRET",
        "FEISHU_TEST_CHAT_ID or FEISHU_DEFAULT_CHAT_ID"
      ]);
      return true;
    }
  );
});

test("loadFdeRuntimeConfig reads production http and redis settings", () => {
  const config = loadFdeRuntimeConfig({
    FDE_ENVIRONMENT: "prod",
    FDE_EVENT_BACKEND: "redis",
    FDE_HTTP_HOST: "0.0.0.0",
    FDE_HTTP_PORT: "3412",
    FDE_HTTP_MAX_BODY_BYTES: "2048",
    FDE_HTTP_REQUEST_TIMEOUT_MS: "3000",
    REDIS_URL: "redis://redis:6379/0",
    FEISHU_MODE: "openapi_bot",
    FEISHU_EVENT_MODE: "websocket",
    FEISHU_APP_ID: "cli_xxx",
    FEISHU_APP_SECRET: "secret",
    FEISHU_TEST_CHAT_ID: "oc_xxx"
  });

  assert.equal(config.environment, "prod");
  assert.equal(config.event_backend, "redis");
  assert.equal(config.http.host, "0.0.0.0");
  assert.equal(config.http.port, 3412);
  assert.equal(config.http.max_body_bytes, 2048);
  assert.equal(config.http.request_timeout_ms, 3000);
  assert.equal(config.feishu.event_mode, "websocket");
});

test("loadFdeRuntimeConfig requires callback credentials only in Feishu http callback mode", () => {
  assert.throws(
    () => loadFdeRuntimeConfig({
      FDE_ENVIRONMENT: "prod",
      FDE_EVENT_BACKEND: "redis",
      REDIS_URL: "redis://redis:6379/0",
      FEISHU_MODE: "openapi_bot",
      FEISHU_EVENT_MODE: "http_callback",
      FEISHU_APP_ID: "cli_xxx",
      FEISHU_APP_SECRET: "secret",
      FEISHU_TEST_CHAT_ID: "oc_xxx"
    }),
    (error: unknown) => {
      assert.ok(error instanceof FdeRuntimeConfigError);
      assert.deepEqual(error.error.details?.["missing_keys"], [
        "FEISHU_CALLBACK_VERIFICATION_TOKEN",
        "FEISHU_CALLBACK_SIGNING_SECRET"
      ]);
      return true;
    }
  );
});
