import test from "node:test";
import assert from "node:assert/strict";
import { assembleToolPool } from "../../src/runtime/tools/registry.js";
import { createBuiltinToolProvider } from "../../src/runtime/tools/builtin-tool-provider.js";
import { createMcpToolProvider } from "../../src/runtime/tools/mcp/mcp-tool-provider.js";
import type { BaseTaskInput } from "../../src/runtime/task-types.js";

test("tool registry merges built-in and MCP tools with built-ins taking name precedence", async () => {
  const mcpProvider = createMcpToolProvider({
    async listTools() {
      return [
        {
          server_name: "fde.external",
          tool_name: "query",
          description: "Query external system.",
          input_schema: { type: "object", properties: {} }
        },
        {
          server_name: "fde.external",
          tool_name: "read_file",
          description: "Conflicting MCP read tool.",
          input_schema: { type: "object", properties: {} }
        }
      ];
    },
    async callTool() {
      return { ok: true };
    }
  });

  const tools = await assembleToolPool(
    {
      ...baseTask,
      allowed_tools: ["read_file", "mcp__fde_external__query", "mcp__fde_external__read_file"]
    },
    [mcpProvider, createBuiltinToolProvider()]
  );

  assert.deepEqual(tools.map((tool) => tool.name), ["mcp__fde_external__query", "mcp__fde_external__read_file", "read_file"]);
  assert.equal(tools.find((tool) => tool.name === "read_file")?.source, "builtin");
});

test("MCP provider manages auth, connection and discovery refresh", async () => {
  let authCalls = 0;
  let connectCalls = 0;
  let disconnectCalls = 0;
  let discoveryVersion = 0;
  let now = 1000;
  const provider = createMcpToolProvider({
    refresh_interval_ms: 10,
    now: () => now,
    client: {
      async authenticate() {
        authCalls += 1;
      },
      async connect() {
        connectCalls += 1;
      },
      async disconnect() {
        disconnectCalls += 1;
      },
      async listTools() {
        discoveryVersion += 1;
        return [
          {
            server_name: "gitlab",
            tool_name: `query_${discoveryVersion}`,
            description: "Query GitLab.",
            input_schema: { type: "object", properties: {} }
          }
        ];
      },
      async callTool() {
        return { ok: true };
      }
    }
  });

  const firstTools = await provider.listTools({
    permission_profile: "ci-readonly",
    allowed_tools: ["mcp__gitlab__query_1"]
  });
  const cachedTools = await provider.listTools({
    permission_profile: "ci-readonly",
    allowed_tools: ["mcp__gitlab__query_1"]
  });
  now = 1011;
  const refreshedTools = await provider.listTools({
    permission_profile: "ci-readonly",
    allowed_tools: ["mcp__gitlab__query_2"]
  });
  await provider.stop?.();

  assert.equal(authCalls, 1);
  assert.equal(connectCalls, 1);
  assert.equal(disconnectCalls, 1);
  assert.deepEqual(firstTools.map((tool) => tool.name), ["mcp__gitlab__query_1"]);
  assert.deepEqual(cachedTools.map((tool) => tool.name), ["mcp__gitlab__query_1"]);
  assert.deepEqual(refreshedTools.map((tool) => tool.name), ["mcp__gitlab__query_2"]);
});

test("MCP provider maps tool call failures to ErrorObject", async () => {
  const provider = createMcpToolProvider({
    client: {
      async listTools() {
        return [
          {
            server_name: "argocd",
            tool_name: "sync_status",
            description: "Read ArgoCD sync status.",
            input_schema: { type: "object", properties: {} }
          }
        ];
      },
      async callTool() {
        throw new Error("token expired");
      }
    }
  });

  const tools = await provider.listTools({
    permission_profile: "ci-readonly",
    allowed_tools: ["mcp__argocd__sync_status"]
  });
  const result = await tools[0].call({}, {});

  assert.equal(result.status, "blocked");
  assert.equal(result.error.code, "AUTHENTICATION_FAILED");
  assert.equal(result.error.retryable, false);
  assert.equal(result.error.details?.runtime_tool_name, "mcp__argocd__sync_status");
});

test("MCP provider does not start when no MCP tool is allowed", async () => {
  let connectCalls = 0;
  const provider = createMcpToolProvider({
    server_name: "argocd",
    client: {
      async connect() {
        connectCalls += 1;
      },
      async listTools() {
        return [
          {
            server_name: "argocd",
            tool_name: "sync_status",
            description: "Read ArgoCD sync status.",
            input_schema: { type: "object", properties: {} }
          }
        ];
      },
      async callTool() {
        return { ok: true };
      }
    }
  });

  const tools = await provider.listTools({
    permission_profile: "ci-readonly",
    allowed_tools: ["read_file"]
  });

  assert.equal(connectCalls, 0);
  assert.deepEqual(tools, []);
});

test("built-in provider exposes run_command with command policy enforcement", async () => {
  const tools = await assembleToolPool(
    {
      ...baseTask,
      permission_profile: "ci-readonly",
      allowed_tools: ["run_command"]
    },
    [
      createBuiltinToolProvider({
        runCommandExecutor: async (input) => ({
          exit_code: 0,
          stdout: input.command,
          stderr: ""
        })
      })
    ]
  );

  assert.deepEqual(tools.map((tool) => tool.name), ["run_command"]);
  const result = await tools[0].call(
    {
      command: "git status",
      cwd: "."
    },
    {
      permission_profile: "ci-readonly",
      allowed_tools: ["run_command"]
    }
  );

  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.output, {
    exit_code: 0,
    stdout: "git status",
    stderr: ""
  });
});

const baseTask: BaseTaskInput = {
  task_id: "task-test",
  agent_type: "pipeline",
  business_task_type: "yaml_governance",
  runtime_capability: "code_task",
  runtime_type: "code_runtime",
  context_refs: [],
  prompt_ref: "prompts/test.md",
  schema_ref: "schemas/agent-runtime/agent-task-result.schema.json",
  permission_profile: "ci-readonly",
  runtime_policy: {
    environment: "dev",
    timeout_ms: 1000,
    max_tool_calls: 8,
    max_tokens: 4000,
    retry_count: 1
  },
  allowed_tools: [],
  model: "configured-model",
  output_format: "json",
  correlation_id: "corr-test",
  trace_id: "trace-test",
  run_id: "run-test"
};
