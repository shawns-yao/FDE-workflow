import test from "node:test";
import assert from "node:assert/strict";
import { loadRedisConfig } from "../../src/config/redis.js";

test("loads docker redis defaults when no environment is provided", () => {
  const config = loadRedisConfig({});

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 6379);
  assert.equal(config.db, 0);
  assert.equal(config.keyPrefix, "fde:");
  assert.equal(config.streamName, "fde.events");
  assert.equal(config.dlqStreamName, "fde.events.dlq");
});

test("parses redis url and stream options from environment", () => {
  const config = loadRedisConfig({
    REDIS_URL: "redis://:secret@redis:6380/2",
    REDIS_KEY_PREFIX: "workstation:",
    FDE_EVENT_STREAM: "custom.events",
    FDE_EVENT_DLQ_STREAM: "custom.events.dlq",
    FDE_REDIS_BLOCK_MS: "1000",
    FDE_REDIS_BATCH_SIZE: "20",
    FDE_REDIS_PENDING_IDLE_MS: "15000"
  });

  assert.equal(config.host, "redis");
  assert.equal(config.port, 6380);
  assert.equal(config.db, 2);
  assert.equal(config.password, "secret");
  assert.equal(config.keyPrefix, "workstation:");
  assert.equal(config.streamName, "custom.events");
  assert.equal(config.dlqStreamName, "custom.events.dlq");
  assert.equal(config.blockMs, 1000);
  assert.equal(config.batchSize, 20);
  assert.equal(config.pendingIdleMs, 15000);
});

test("ignores empty split redis fields when redis url is provided", () => {
  const config = loadRedisConfig({
    REDIS_URL: "redis://redis:6379/0",
    REDIS_HOST: "",
    REDIS_PORT: "",
    REDIS_DB: "",
    REDIS_PASSWORD: "",
    REDIS_KEY_PREFIX: ""
  });

  assert.equal(config.host, "redis");
  assert.equal(config.port, 6379);
  assert.equal(config.db, 0);
  assert.equal(config.password, undefined);
  assert.equal(config.keyPrefix, "fde:");
});
