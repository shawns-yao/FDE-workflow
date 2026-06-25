import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSchemaRegistry } from "../../src/common/schema-registry.js";

test("schema registry validates nested local $ref requirements", async () => {
  const root = await mkdtemp(join(tmpdir(), "fde-schema-"));
  try {
    await writeFile(
      join(root, "child.schema.json"),
      JSON.stringify({
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" }
        }
      })
    );
    await writeFile(
      join(root, "parent.schema.json"),
      JSON.stringify({
        type: "object",
        required: ["child"],
        properties: {
          child: { $ref: "child.schema.json" }
        }
      })
    );

    const registry = new FileSchemaRegistry(root);
    const valid = await registry.validate("parent.schema.json", { child: { name: "ok" } });
    const invalid = await registry.validate("parent.schema.json", { child: {} });

    assert.equal(valid.valid, true);
    assert.equal(invalid.valid, false);
    assert.match(invalid.errors[0], /name/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("schema registry rejects additional properties and scalar constraint violations", async () => {
  const root = await mkdtemp(join(tmpdir(), "fde-schema-"));
  try {
    await writeFile(
      join(root, "strict.schema.json"),
      JSON.stringify({
        type: "object",
        required: ["name", "count"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 2 },
          count: { type: "integer", minimum: 1 }
        }
      })
    );

    const registry = new FileSchemaRegistry(root);
    const valid = await registry.validate("strict.schema.json", { name: "ok", count: 1 });
    const invalid = await registry.validate("strict.schema.json", { name: "", count: 0, extra: true });

    assert.equal(valid.valid, true);
    assert.equal(invalid.valid, false);
    assert.match(invalid.errors.join("\n"), /additional property/);
    assert.match(invalid.errors.join("\n"), /string length/);
    assert.match(invalid.errors.join("\n"), /number must be >= 1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("schema registry supports anyOf and pattern constraints for runtime MCP tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "fde-schema-"));
  try {
    await writeFile(
      join(root, "tool.schema.json"),
      JSON.stringify({
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: {
          name: {
            anyOf: [
              { enum: ["read_file", "list_files"] },
              { type: "string", pattern: "^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$" }
            ]
          }
        }
      })
    );

    const registry = new FileSchemaRegistry(root);
    const builtin = await registry.validate("tool.schema.json", { name: "read_file" });
    const mcp = await registry.validate("tool.schema.json", { name: "mcp__argocd__get_application_status" });
    const invalid = await registry.validate("tool.schema.json", { name: "mcp_argocd_get_application_status" });

    assert.equal(builtin.valid, true);
    assert.equal(mcp.valid, true);
    assert.equal(invalid.valid, false);
    assert.match(invalid.errors.join("\n"), /anyOf/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent task schema accepts MCP runtime tool names", async () => {
  const registry = new FileSchemaRegistry("schemas");
  const result = await registry.validate("agent-runtime/agent-task.schema.json", {
    task_id: "task-mcp",
    agent_type: "diagnosis",
    business_task_type: "root_cause",
    runtime_capability: "analysis_task",
    runtime_type: "claude_api",
    context_refs: [],
    prompt_ref: "prompts/diagnosis/root-cause.md",
    schema_ref: "schemas/agent-runtime/agent-task-result.schema.json",
    permission_profile: "diagnosis-readonly",
    runtime_policy: {
      environment: "dev",
      timeout_ms: 1000,
      max_tool_calls: 4,
      max_tokens: 1000,
      retry_count: 0
    },
    allowed_tools: ["read_artifact", "mcp__argocd__get_application_status"],
    model: "configured-model",
    output_format: "json",
    correlation_id: "corr-test",
    trace_id: "trace-test",
    run_id: "run-test"
  });

  assert.equal(result.valid, true, result.errors.join("\n"));
});
