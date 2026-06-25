import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMcpToolProvider } from "../../src/runtime/tools/mcp/mcp-tool-provider.js";
import { StdioMcpClient } from "../../src/runtime/tools/mcp/stdio-mcp-client.js";

test("stdio MCP client initializes, discovers tools and calls a tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "fde-mcp-"));
  const serverPath = join(root, "mock-mcp-server.cjs");
  await writeFile(serverPath, mockMcpServerSource());

  const client = new StdioMcpClient({
    server_name: "mock",
    command: process.execPath,
    args: [serverPath],
    request_timeout_ms: 1000
  });
  const provider = createMcpToolProvider({ client });

  try {
    const tools = await provider.listTools({
      permission_profile: "ci-readonly",
      allowed_tools: ["mcp__mock__echo"]
    });
    assert.deepEqual(tools.map((tool) => tool.name), ["mcp__mock__echo"]);

    const result = await tools[0].call({ value: "hello" }, {});
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.output, { received: { value: "hello" } });
  } finally {
    await provider.stop?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("stdio MCP client rejects missing required auth environment", async () => {
  const client = new StdioMcpClient({
    server_name: "secure",
    command: process.execPath,
    args: ["unused"],
    required_env: ["FDE_TEST_MISSING_TOKEN"]
  });

  await assert.rejects(
    () => client.authenticate(),
    (error) => {
      const candidate = error as { error?: { code?: string; details?: Record<string, unknown> } };
      assert.equal(candidate.error?.code, "AUTHENTICATION_FAILED");
      assert.deepEqual(candidate.error?.details?.missing_env, ["FDE_TEST_MISSING_TOKEN"]);
      return true;
    }
  );
});

function mockMcpServerSource(): string {
  return String.raw`
let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const lengthLine = header.split("\r\n").find((line) => line.toLowerCase().startsWith("content-length:"));
    const length = Number.parseInt(lengthLine.split(":")[1].trim(), 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const message = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf8"));
    buffer = buffer.subarray(bodyEnd);
    handle(message);
  }
});

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write("Content-Length: " + body.length + "\r\n\r\n");
  process.stdout.write(body);
}

function handle(message) {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mock", version: "0.1.0" }
      }
    });
    return;
  }
  if (message.method === "notifications/initialized") {
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo arguments.",
            inputSchema: {
              type: "object",
              properties: { value: { type: "string" } }
            }
          }
        ]
      }
    });
    return;
  }
  if (message.method === "tools/call") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { received: message.params.arguments }
      }
    });
  }
}
`;
}
