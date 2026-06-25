import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalArtifactStore } from "../../src/common/artifact-store.js";
import { FileSchemaRegistry } from "../../src/common/schema-registry.js";
import { createCodeRuntimeExecutor } from "../../src/runtime/executors/code-runtime/code-task-executor.js";
import type { AnthropicContentBlock, AnthropicMessageResponse, AnthropicMessagesClient } from "../../src/runtime/adapters/anthropic/messages-client.js";
import type { BaseTaskInput } from "../../src/runtime/task-types.js";

test("code runtime executor returns structured output and writes raw result artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "fde-code-runtime-"));
  try {
    await mkdir(join(root, "schemas", "pipeline"), { recursive: true });
    await mkdir(join(root, "prompts", "pipeline"), { recursive: true });
    await writeFile(join(root, "prompts", "pipeline", "yaml-governance.md"), "Review YAML diff and return JSON.");
    await writeFile(join(root, "schemas", "pipeline", "yaml-governance-result.schema.json"), JSON.stringify(yamlGovernanceSchema));

    const artifactStore = new LocalArtifactStore(root);
    const diffArtifact = await artifactStore.write({
      run_id: "run-test",
      artifact_uri: "artifacts/runs/run-test/yaml.diff",
      artifact_type: "diff",
      content_type: "text/plain",
      content: "--- a/app/dev.yaml\n+++ b/app/dev.yaml\n-image: old\n+image: new\n"
    });
    const client = new FakeAnthropicClient(JSON.stringify({
      approved: true,
      risk_level: "low",
      summary: "Only image tag changed.",
      changed_files_reviewed: ["app/dev.yaml"],
      findings: [],
      required_fixes: [],
      auto_fixed: []
    }));
    const executor = createCodeRuntimeExecutor({
      client,
      artifactStore,
      schemaRegistry: new FileSchemaRegistry(join(root, "schemas")),
      cwd: root
    });

    const result = await executor({
      ...baseTask,
      artifact_refs: [diffArtifact]
    });

    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.structured_data, {
      approved: true,
      risk_level: "low",
      summary: "Only image tag changed.",
      changed_files_reviewed: ["app/dev.yaml"],
      findings: [],
      required_fixes: [],
      auto_fixed: []
    });
    assert.equal(result.artifact_refs.length, 1);
    assert.equal(result.artifact_refs[0].artifact_type, "agent_task_result");
    assert.match(client.lastPrompt, /yaml\.diff/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("code runtime executor fails when structured output does not match schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "fde-code-runtime-"));
  try {
    await mkdir(join(root, "schemas", "pipeline"), { recursive: true });
    await writeFile(join(root, "schemas", "pipeline", "yaml-governance-result.schema.json"), JSON.stringify(yamlGovernanceSchema));
    const executor = createCodeRuntimeExecutor({
      client: new FakeAnthropicClient(JSON.stringify({ approved: true })),
      artifactStore: new LocalArtifactStore(root),
      schemaRegistry: new FileSchemaRegistry(join(root, "schemas")),
      cwd: root
    });

    const result = await executor(baseTask);

    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "SCHEMA_VALIDATION_FAILED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("code runtime executor handles read-only tool use before final output", async () => {
  const root = await mkdtemp(join(tmpdir(), "fde-code-runtime-"));
  try {
    await mkdir(join(root, "schemas", "pipeline"), { recursive: true });
    await mkdir(join(root, "prompts", "pipeline"), { recursive: true });
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(join(root, "prompts", "pipeline", "yaml-governance.md"), "Read files if needed and return JSON.");
    await writeFile(join(root, "schemas", "pipeline", "yaml-governance-result.schema.json"), JSON.stringify(yamlGovernanceSchema));
    await writeFile(join(root, "app", "dev.yaml"), "image: registry/app:new\n");

    const client = new ToolUseAnthropicClient();
    const executor = createCodeRuntimeExecutor({
      client,
      artifactStore: new LocalArtifactStore(root),
      schemaRegistry: new FileSchemaRegistry(join(root, "schemas")),
      cwd: root
    });

    const result = await executor({
      ...baseTask,
      workspace_ref: root
    });

    assert.equal(result.status, "succeeded");
    assert.equal(result.tool_trace_ref?.endsWith(".json"), true);
    assert.equal(result.artifact_refs.some((artifact) => artifact.artifact_type === "tool_trace"), true);
    assert.equal(client.calls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class FakeAnthropicClient implements AnthropicMessagesClient {
  lastPrompt = "";

  constructor(private readonly text: string) {}

  async createMessage(input: Parameters<AnthropicMessagesClient["createMessage"]>[0]): Promise<AnthropicMessageResponse> {
    this.lastPrompt = input.prompt;
    const content: AnthropicContentBlock[] = [{ type: "text", text: this.text }];
    return {
      text: this.text,
      content,
      input_tokens: 10,
      output_tokens: 20,
      raw: {
        content
      }
    };
  }
}

class ToolUseAnthropicClient implements AnthropicMessagesClient {
  calls = 0;

  async createMessage(): Promise<AnthropicMessageResponse> {
    this.calls += 1;
    if (this.calls === 1) {
      const content: AnthropicContentBlock[] = [
        {
          type: "tool_use",
          id: "toolu-1",
          name: "read_file",
          input: {
            path: "app/dev.yaml"
          }
        }
      ];
      return {
        text: "",
        content,
        stop_reason: "tool_use",
        input_tokens: 10,
        output_tokens: 5,
        raw: { content }
      };
    }
    const text = JSON.stringify({
      approved: true,
      risk_level: "low",
      summary: "Read file and approved image change.",
      changed_files_reviewed: ["app/dev.yaml"],
      findings: [],
      required_fixes: [],
      auto_fixed: []
    });
    return {
      text,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      input_tokens: 20,
      output_tokens: 20,
      raw: {
        content: [{ type: "text", text }]
      }
    };
  }
}

const baseTask: BaseTaskInput = {
  task_id: "task-yaml-governance",
  agent_type: "pipeline",
  business_task_type: "yaml_governance",
  runtime_capability: "code_task",
  runtime_type: "code_runtime",
  workspace_ref: "C:/work/gitops-config",
  context_refs: ["pipeline-build:build-1"],
  artifact_refs: [],
  prompt_ref: "prompts/pipeline/yaml-governance.md",
  schema_ref: "schemas/pipeline/yaml-governance-result.schema.json",
  permission_profile: "ci-yaml-edit",
  runtime_policy: {
    environment: "dev",
    timeout_ms: 1000,
    max_tool_calls: 8,
    max_tokens: 2000,
    retry_count: 1
  },
  allowed_tools: ["read_file", "edit_file", "write_file", "list_files", "read_artifact", "write_artifact", "validate_schema"],
  model: "test-model",
  output_format: "json",
  correlation_id: "corr-test",
  trace_id: "trace-test",
  run_id: "run-test"
};

const yamlGovernanceSchema = {
  type: "object",
  required: ["approved", "risk_level", "summary", "changed_files_reviewed", "findings", "required_fixes", "auto_fixed"],
  additionalProperties: false,
  properties: {
    approved: { type: "boolean" },
    risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
    summary: { type: "string", minLength: 1 },
    changed_files_reviewed: { type: "array", items: { type: "string", minLength: 1 } },
    findings: { type: "array", items: { type: "object" } },
    required_fixes: { type: "array", items: { type: "string" } },
    auto_fixed: { type: "array", items: { type: "string" } }
  }
};
