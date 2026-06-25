import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LocalArtifactStore, type ArtifactStore } from "../../../common/artifact-store.js";
import type { ErrorObject } from "../../../common/contracts.js";
import { FileSchemaRegistry, type SchemaRegistry } from "../../../common/schema-registry.js";
import type { RuntimeExecutor } from "../../agent-runtime.js";
import type { BaseTaskInput, TaskResult } from "../../task-types.js";
import { type AnthropicContentBlock, type AnthropicConversationMessage, type AnthropicMessagesClient, RuntimeModelError } from "../../adapters/anthropic/messages-client.js";
import type { CoreTool, ToolProvider } from "../../tools/core-tool.js";
import { createBuiltinToolProvider } from "../../tools/builtin-tool-provider.js";
import { assembleToolPool } from "../../tools/registry.js";

export interface CodeRuntimeExecutorOptions {
  client: AnthropicMessagesClient;
  artifactStore?: ArtifactStore;
  schemaRegistry?: SchemaRegistry;
  toolProviders?: ToolProvider[];
  cwd?: string;
  now?: () => Date;
}

export function createCodeRuntimeExecutor(options: CodeRuntimeExecutorOptions): RuntimeExecutor {
  const executor = new CodeRuntimeExecutor(options);
  return (input) => executor.run(input);
}

class CodeRuntimeExecutor {
  private readonly artifactStore: ArtifactStore;
  private readonly schemaRegistry: SchemaRegistry;
  private readonly toolProviders: ToolProvider[];
  private readonly cwd: string;
  private readonly now: () => Date;

  constructor(private readonly options: CodeRuntimeExecutorOptions) {
    this.cwd = options.cwd ?? process.cwd();
    this.artifactStore = options.artifactStore ?? new LocalArtifactStore(this.cwd);
    this.schemaRegistry = options.schemaRegistry ?? new FileSchemaRegistry(resolve(this.cwd, "schemas"));
    this.toolProviders = options.toolProviders ?? [createBuiltinToolProvider()];
    this.now = options.now ?? (() => new Date());
  }

  async run(input: BaseTaskInput): Promise<Omit<TaskResult, "permission_audit">> {
    try {
      const prompt = await this.buildPrompt(input);
      const tools = await assembleToolPool(input, this.toolProviders);
      const messages: AnthropicConversationMessage[] = [
        {
          role: "user",
          content: prompt
        }
      ];
      const toolTrace: ToolTraceEntry[] = [];
      let response = await this.options.client.createMessage({
        model: input.model,
        max_tokens: input.runtime_policy.max_tokens,
        system: "You are the FDE code_runtime executor. Use tools when needed, then return only valid JSON matching the requested schema.",
        prompt,
        messages,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema
        }))
      });
      let toolCallCount = 0;

      while (toolUseBlocks(response.content).length > 0) {
        if (toolCallCount >= input.runtime_policy.max_tool_calls) {
          throw new Error("Runtime tool call limit exceeded.");
        }
        messages.push({
          role: "assistant",
          content: response.content
        });
        const toolResults: AnthropicContentBlock[] = [];
        for (const toolUse of toolUseBlocks(response.content)) {
          toolCallCount += 1;
          const tool = tools.find((candidate) => candidate.name === toolUse.name);
          const startedAt = this.now().toISOString();
          const result = tool
            ? await tool.call(toolUse.input, {
                workspace_ref: input.workspace_ref,
                permission_profile: input.permission_profile,
                allowed_tools: input.allowed_tools
              })
            : {
                status: "blocked" as const,
                error: {
                  code: "TOOL_PERMISSION_DENIED" as const,
                  message: `Tool is not allowed: ${toolUse.name}`,
                  retryable: false,
                  severity: "error" as const,
                  details: { tool_name: toolUse.name }
                }
              };
          toolTrace.push({
            tool_use_id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input,
            status: result.status,
            started_at: startedAt,
            finished_at: this.now().toISOString()
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result.status === "succeeded" ? result.output : { error: result.error }),
            is_error: result.status !== "succeeded"
          });
        }
        messages.push({
          role: "user",
          content: toolResults
        });
        response = await this.options.client.createMessage({
          model: input.model,
          max_tokens: input.runtime_policy.max_tokens,
          system: "You are the FDE code_runtime executor. Use tools when needed, then return only valid JSON matching the requested schema.",
          prompt,
          messages,
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema
          }))
        });
      }

      const structuredData = parseStructuredJson(response.text);
      const validation = await this.validateStructuredData(input.schema_ref, structuredData);
      const rawOutputArtifact = await this.artifactStore.write({
        run_id: input.run_id,
        artifact_type: "agent_task_result",
        content_type: "application/json",
        content: {
          task_id: input.task_id,
          model: input.model,
          output: response.text,
          structured_data: structuredData,
          raw: response.raw,
          created_at: this.now().toISOString()
        },
        excerpt: response.text.slice(0, 512)
      });
      const toolTraceArtifact = toolTrace.length > 0 ? await this.artifactStore.write({
        run_id: input.run_id,
        artifact_type: "tool_trace",
        content_type: "application/json",
        content: {
          task_id: input.task_id,
          tool_calls: toolTrace
        },
        excerpt: `${toolTrace.length} tool call(s)`
      }) : undefined;

      if (!validation.valid) {
        return {
          task_id: input.task_id,
          status: "failed",
          output: response.text,
          structured_data: structuredData,
          artifact_refs: compactArtifacts([rawOutputArtifact, toolTraceArtifact]),
          tool_trace_ref: toolTraceArtifact?.artifact_uri,
          token_usage: {
            input_tokens: response.input_tokens,
            output_tokens: response.output_tokens
          },
          error: {
            code: "SCHEMA_VALIDATION_FAILED",
            message: "Runtime structured output did not match schema.",
            retryable: false,
            severity: "error",
            details: {
              schema_ref: input.schema_ref,
              errors: validation.errors
            }
          }
        };
      }

      return {
        task_id: input.task_id,
        status: "succeeded",
        output: response.text,
        structured_data: structuredData,
        artifact_refs: compactArtifacts([rawOutputArtifact, toolTraceArtifact]),
        tool_trace_ref: toolTraceArtifact?.artifact_uri,
        token_usage: {
          input_tokens: response.input_tokens,
          output_tokens: response.output_tokens
        }
      };
    } catch (error) {
      const errorObject = normalizeRuntimeError(error);
      return {
        task_id: input.task_id,
        status: errorObject.code === "AUTHENTICATION_FAILED" ? "blocked" : "failed",
        output: "",
        artifact_refs: [],
        token_usage: {
          input_tokens: 0,
          output_tokens: 0
        },
        error: errorObject
      };
    }
  }

  private async buildPrompt(input: BaseTaskInput): Promise<string> {
    const promptTemplate = await readOptionalText(resolve(this.cwd, input.prompt_ref));
    const artifactContents = await Promise.all((input.artifact_refs ?? []).map(async (artifact) => {
      const content = await this.artifactStore.read(artifact.artifact_uri);
      return [
        `artifact_uri: ${artifact.artifact_uri}`,
        `artifact_type: ${artifact.artifact_type}`,
        "content:",
        content.toString("utf8").slice(0, 50000)
      ].join("\n");
    }));

    return [
      promptTemplate ?? defaultPrompt(input),
      "",
      "Task metadata:",
      JSON.stringify({
        task_id: input.task_id,
        agent_type: input.agent_type,
        business_task_type: input.business_task_type,
        runtime_capability: input.runtime_capability,
        environment: input.runtime_policy.environment,
        workspace_ref: input.workspace_ref,
        context_refs: input.context_refs,
        schema_ref: input.schema_ref,
        correlation_id: input.correlation_id,
        trace_id: input.trace_id,
        run_id: input.run_id
      }, null, 2),
      "",
      "Artifacts:",
      artifactContents.length > 0 ? artifactContents.join("\n\n---\n\n") : "No artifact content provided.",
      "",
      "Output requirements:",
      "Return only one JSON object. Do not wrap it in Markdown. Do not include explanatory text outside JSON."
    ].join("\n");
  }

  private async validateStructuredData(schemaRef: string, structuredData: unknown): Promise<{ valid: boolean; errors: string[] }> {
    const normalizedRef = schemaRef.startsWith("schemas/") ? schemaRef.slice("schemas/".length) : schemaRef;
    return this.schemaRegistry.validate(normalizedRef, structuredData);
  }
}

interface ToolTraceEntry {
  tool_use_id: string;
  name: string;
  input: unknown;
  status: string;
  started_at: string;
  finished_at: string;
}

function toolUseBlocks(blocks: AnthropicContentBlock[]): Array<{ type: "tool_use"; id: string; name: string; input: unknown }> {
  return blocks.filter((block): block is { type: "tool_use"; id: string; name: string; input: unknown } => block.type === "tool_use");
}

function compactArtifacts<T>(items: Array<T | undefined>): T[] {
  return items.filter((item): item is T => Boolean(item));
}

function defaultPrompt(input: BaseTaskInput): string {
  if (input.business_task_type === "yaml_governance") {
    return [
      "Review the GitOps YAML diff for deployment risk.",
      "Approve only if the change is expected, scoped to the intended image tag update, and does not introduce high-risk Kubernetes configuration.",
      "Return JSON with fields: approved, risk_level, summary, changed_files_reviewed, findings, required_fixes, auto_fixed."
    ].join("\n");
  }
  return "Complete the requested code runtime task and return structured JSON.";
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function parseStructuredJson(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
    }
    throw new Error("Runtime output is not valid JSON.");
  }
}

function normalizeRuntimeError(error: unknown): ErrorObject {
  if (error instanceof RuntimeModelError) {
    return error.error;
  }
  if (isErrorObjectCarrier(error)) {
    return error.error;
  }
  return {
    code: "LLM_UNAVAILABLE",
    message: error instanceof Error ? error.message : "Runtime execution failed.",
    retryable: true,
    severity: "error",
    details: {}
  };
}

function isErrorObjectCarrier(error: unknown): error is { error: ErrorObject } {
  if (error === null || typeof error !== "object" || !("error" in error)) {
    return false;
  }
  return (error as { error?: unknown }).error !== null && typeof (error as { error?: unknown }).error === "object";
}
