import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  createRuntimeMcpToolProviders,
  loadRuntimeMcpServerConfigsFromEnv,
  parseRuntimeMcpServerConfigs,
  RUNTIME_MCP_SERVERS_ENV
} from "../../src/runtime/tools/mcp/runtime-mcp-config.js";

test("runtime MCP config parses stdio server definitions", () => {
  const configs = parseRuntimeMcpServerConfigs(JSON.stringify([
    {
      transport: "stdio",
      server_name: "fde.argocd",
      command: "node",
      args: ["server.js"],
      required_env: ["ARGOCD_TOKEN"],
      request_timeout_ms: 1000,
      refresh_interval_ms: 2000
    }
  ]));

  assert.equal(configs.length, 1);
  assert.equal(configs[0].server_name, "fde_argocd");
  assert.equal(configs[0].command, "node");
  assert.deepEqual(configs[0].args, ["server.js"]);
  assert.deepEqual(configs[0].required_env, ["ARGOCD_TOKEN"]);
});

test("runtime MCP config rejects invalid JSON and unsupported transports", () => {
  assert.throws(
    () => parseRuntimeMcpServerConfigs("{"),
    (error) => {
      const candidate = error as { error?: { code?: string } };
      assert.equal(candidate.error?.code, "CONFIGURATION_INVALID");
      return true;
    }
  );

  assert.throws(
    () => parseRuntimeMcpServerConfigs(JSON.stringify([{ transport: "http", server_name: "x", command: "node" }])),
    /Unsupported Runtime MCP transport/
  );
});

test("runtime MCP providers are created from environment config and stay lazy", async () => {
  let spawnCalls = 0;
  const providers = createRuntimeMcpToolProviders(
    loadRuntimeMcpServerConfigsFromEnv({
      [RUNTIME_MCP_SERVERS_ENV]: JSON.stringify([
        {
          transport: "stdio",
          server_name: "argocd",
          command: "node",
          args: ["server.js"]
        }
      ])
    } as NodeJS.ProcessEnv),
    {
      spawn: () => {
        spawnCalls += 1;
        return new FakeChildProcess() as unknown as ChildProcessWithoutNullStreams;
      }
    }
  );

  assert.equal(providers.length, 1);
  const tools = await providers[0].listTools({
    permission_profile: "ci-readonly",
    allowed_tools: ["read_file"]
  });

  assert.deepEqual(tools, []);
  assert.equal(spawnCalls, 0);
});

class FakeChildProcess extends EventEmitter {
  stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  stdout = new PassThrough();
  stderr = new PassThrough();

  kill(): boolean {
    this.emit("exit", 0, null);
    return true;
  }
}
