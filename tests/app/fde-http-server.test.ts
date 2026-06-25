import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { EventHttpHandlerInput, EventHttpHandlerResponse } from "../../src/events/event-http-handler.js";
import { createFdeHttpServer } from "../../src/app/fde-http-server.js";

test("fde http server exposes health endpoint", async () => {
  const server = createFdeHttpServer({
    environment: "dev",
    eventHandler: {
      async handle(): Promise<EventHttpHandlerResponse> {
        throw new Error("event handler should not be called");
      }
    }
  });

  await listen(server);
  try {
    const response = await fetch(baseUrl(server) + "/health");
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body["status"], "ok");
    assert.equal(body["service"], "fde-workstation");
    assert.equal(body["environment"], "dev");
  } finally {
    await close(server);
  }
});

test("fde http server exposes readiness endpoint from injected check", async () => {
  const server = createFdeHttpServer({
    environment: "prod",
    eventHandler: {
      async handle(): Promise<EventHttpHandlerResponse> {
        throw new Error("event handler should not be called");
      }
    },
    readyCheck: async () => ({
      ready: true,
      checks: {
        redis: "ok"
      }
    })
  });

  await listen(server);
  try {
    const response = await fetch(baseUrl(server) + "/ready");
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body["status"], "ready");
    assert.deepEqual(body["checks"], { redis: "ok" });
  } finally {
    await close(server);
  }
});

test("fde http server rejects request bodies above configured limit", async () => {
  const received: EventHttpHandlerInput[] = [];
  const server = createFdeHttpServer({
    environment: "test",
    maxBodyBytes: 8,
    eventHandler: {
      async handle(input): Promise<EventHttpHandlerResponse> {
        received.push(input);
        return {
          statusCode: 202,
          body: {
            accepted: true
          }
        };
      }
    }
  });

  await listen(server);
  try {
    const response = await fetch(baseUrl(server) + "/webhook/gitlab", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ payload: "too-large" })
    });
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 413);
    assert.deepEqual(body["error"], {
      code: "SCHEMA_VALIDATION_FAILED",
      message: "HTTP request body exceeds configured limit.",
      retryable: false,
      severity: "error",
      details: {
        max_body_bytes: 8
      }
    });
    assert.equal(received.length, 0);
  } finally {
    await close(server);
  }
});

test("fde http server routes feishu callback to event http handler", async () => {
  const received: EventHttpHandlerInput[] = [];
  const server = createFdeHttpServer({
    environment: "test",
    eventHandler: {
      async handle(input): Promise<EventHttpHandlerResponse> {
        received.push(input);
        return {
          statusCode: 202,
          body: {
            accepted: true
          }
        };
      }
    }
  });

  await listen(server);
  try {
    const response = await fetch(baseUrl(server) + "/webhook/feishu/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fde-correlation-id": "corr-test"
      },
      body: JSON.stringify({
        message_id: "msg-1"
      })
    });
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 202);
    assert.equal(body["accepted"], true);
    assert.equal(received.length, 1);
    assert.equal(received[0].method, "POST");
    assert.equal(received[0].path, "/webhook/feishu");
    assert.equal(received[0].environment, "test");
    assert.equal(received[0].headers["x-fde-correlation-id"], "corr-test");
    assert.equal(received[0].rawBody, JSON.stringify({ message_id: "msg-1" }));
  } finally {
    await close(server);
  }
});

function listen(server: ReturnType<typeof createFdeHttpServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: ReturnType<typeof createFdeHttpServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function baseUrl(server: ReturnType<typeof createFdeHttpServer>): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
