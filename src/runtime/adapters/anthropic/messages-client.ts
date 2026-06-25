import type { ErrorObject } from "../../../common/contracts.js";

export interface AnthropicMessageRequest {
  model: string;
  max_tokens: number;
  system?: string;
  prompt: string;
  messages?: AnthropicConversationMessage[];
  tools?: AnthropicToolDefinition[];
}

export type AnthropicConversationMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicMessageResponse {
  text: string;
  content: AnthropicContentBlock[];
  stop_reason?: string;
  input_tokens: number;
  output_tokens: number;
  raw: unknown;
}

export interface AnthropicMessagesClient {
  createMessage(input: AnthropicMessageRequest): Promise<AnthropicMessageResponse>;
}

export type AnthropicFetch = (url: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface AnthropicMessagesClientOptions {
  apiKey: string;
  baseUrl?: string;
  version?: string;
  fetch?: AnthropicFetch;
}

export class HttpAnthropicMessagesClient implements AnthropicMessagesClient {
  private readonly baseUrl: string;
  private readonly version: string;

  constructor(private readonly options: AnthropicMessagesClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.version = options.version ?? "2023-06-01";
  }

  async createMessage(input: AnthropicMessageRequest): Promise<AnthropicMessageResponse> {
    const response = await (this.options.fetch ?? defaultFetch)(`${this.baseUrl.replace(/\/+$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": this.version,
        "x-api-key": this.options.apiKey
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.max_tokens,
        system: input.system,
        messages: input.messages ?? [
          {
            role: "user",
            content: input.prompt
          }
        ],
        tools: input.tools && input.tools.length > 0 ? input.tools : undefined
      })
    });

    const bodyText = await response.text();
    const parsed = parseJson(bodyText);
    if (!response.ok) {
      throw anthropicError(response.status, parsed);
    }

    return {
      text: extractText(parsed),
      content: extractContent(parsed),
      stop_reason: isRecord(parsed) && typeof parsed.stop_reason === "string" ? parsed.stop_reason : undefined,
      input_tokens: readUsage(parsed, "input_tokens"),
      output_tokens: readUsage(parsed, "output_tokens"),
      raw: parsed
    };
  }
}

export function createAnthropicMessagesClientFromEnv(env: Partial<Record<string, string | undefined>> = process.env): AnthropicMessagesClient | undefined {
  const apiKey = env.ANTHROPIC_API_KEY ?? env.CLAUDE_API_KEY;
  if (!apiKey) {
    return undefined;
  }
  return new HttpAnthropicMessagesClient({
    apiKey,
    baseUrl: env.ANTHROPIC_BASE_URL,
    version: env.ANTHROPIC_VERSION
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw_text: text };
  }
}

function extractText(value: unknown): string {
  return extractContent(value)
    .map((item) => item.type === "text" ? item.text : "")
    .filter(Boolean)
    .join("\n");
}

function extractContent(value: unknown): AnthropicContentBlock[] {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return [];
  }
  return value.content
    .map((item): AnthropicContentBlock | undefined => {
      if (!isRecord(item) || typeof item.type !== "string") {
        return undefined;
      }
      if (item.type === "text" && typeof item.text === "string") {
        return { type: "text", text: item.text };
      }
      if (item.type === "tool_use" && typeof item.id === "string" && typeof item.name === "string") {
        return { type: "tool_use", id: item.id, name: item.name, input: item.input };
      }
      return undefined;
    })
    .filter((item): item is AnthropicContentBlock => Boolean(item));
}

function readUsage(value: unknown, key: "input_tokens" | "output_tokens"): number {
  if (!isRecord(value) || !isRecord(value.usage)) {
    return 0;
  }
  const tokenCount = value.usage[key];
  return typeof tokenCount === "number" && Number.isFinite(tokenCount) ? tokenCount : 0;
}

function anthropicError(status: number, body: unknown): Error {
  const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string"
    ? body.error.message
    : `Anthropic API request failed with status ${status}`;
  return new RuntimeModelError({
    code: status === 401 || status === 403 ? "AUTHENTICATION_FAILED" : "LLM_UNAVAILABLE",
    message,
    retryable: status === 429 || status >= 500,
    severity: status >= 500 || status === 429 ? "error" : "warning",
    details: {
      status
    }
  });
}

export class RuntimeModelError extends Error {
  constructor(readonly error: ErrorObject) {
    super(error.message);
  }
}

async function defaultFetch(url: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}) {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
