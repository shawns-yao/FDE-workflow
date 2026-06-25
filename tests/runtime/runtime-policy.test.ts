import test from "node:test";
import assert from "node:assert/strict";
import { PolicyCheckedAgentRuntime } from "../../src/runtime/agent-runtime.js";
import type { BaseTaskInput, TaskResult } from "../../src/runtime/task-types.js";
import { createRunCommandTool } from "../../src/runtime/tools/run-command.js";

test("runtime returns timed_out when executor exceeds runtime policy timeout", async () => {
  const runtime = new PolicyCheckedAgentRuntime({
    code_task: async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return baseResult(input, "succeeded");
    }
  });

  const result = await runtime.runCodeTask({
    ...baseTask,
    runtime_policy: {
      ...baseTask.runtime_policy,
      timeout_ms: 5
    }
  });

  assert.equal(result.status, "timed_out");
  assert.equal(result.error?.retryable, true);
});

test("runtime blocks tasks when input capability does not match entrypoint", async () => {
  const runtime = new PolicyCheckedAgentRuntime({
    code_task: async (input) => baseResult(input, "succeeded")
  });

  const result = await runtime.runCodeTask({
    ...baseTask,
    runtime_capability: "analysis_task"
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.error?.code, "CONFIGURATION_INVALID");
});

test("runtime allows MCP tools declared for the permission profile server allowlist", async () => {
  const runtime = new PolicyCheckedAgentRuntime({
    code_task: async (input) => baseResult(input, "succeeded")
  });

  const result = await runtime.runCodeTask({
    ...baseTask,
    allowed_tools: ["mcp__argocd__sync_status"]
  });

  assert.equal(result.status, "succeeded");
});

test("runtime blocks MCP tools outside the permission profile server allowlist", async () => {
  const runtime = new PolicyCheckedAgentRuntime({
    analysis_task: async (input) => baseResult(input, "succeeded")
  });

  const result = await runtime.runAnalysisTask({
    ...baseTask,
    runtime_capability: "analysis_task",
    permission_profile: "diagnosis-readonly",
    allowed_tools: ["mcp__feishu__send_card"]
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.error?.code, "TOOL_PERMISSION_DENIED");
});

test("run_command tool rejects commands outside permission profile allowlist before execution", async () => {
  let executed = false;
  const tool = createRunCommandTool({
    execute: async () => {
      executed = true;
      return { exit_code: 0, stdout: "bad", stderr: "" };
    }
  });

  const result = await tool.call(
    {
      command: "kubectl get pods",
      cwd: ".",
      env: {}
    },
    {
      permission_profile: "ci-readonly",
      allowed_tools: ["run_command"]
    }
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.error?.code, "TOOL_PERMISSION_DENIED");
  assert.equal(executed, false);
});

test("run_command tool executes commands allowed by permission profile", async () => {
  const tool = createRunCommandTool({
    execute: async (input) => {
      return { exit_code: 0, stdout: `executed ${input.command}`, stderr: "" };
    }
  });

  const result = await tool.call(
    {
      command: "git status --short",
      cwd: ".",
      env: {}
    },
    {
      permission_profile: "ci-readonly",
      allowed_tools: ["run_command"]
    }
  );

  assert.equal(result.status, "succeeded");
  const output = result.output as { stdout?: string };
  assert.equal(output.stdout, "executed git status --short");
});

const baseTask: BaseTaskInput = {
  task_id: "task-test",
  agent_type: "pipeline",
  business_task_type: "mr_review",
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
  allowed_tools: ["read_file", "list_files", "run_command"],
  model: "configured-model",
  output_format: "json",
  correlation_id: "corr-test",
  trace_id: "trace-test",
  run_id: "run-test"
};

function baseResult(input: BaseTaskInput, status: TaskResult["status"]): Omit<TaskResult, "permission_audit"> {
  return {
    task_id: input.task_id,
    status,
    output: "",
    artifact_refs: [],
    token_usage: {
      input_tokens: 0,
      output_tokens: 0
    }
  };
}
