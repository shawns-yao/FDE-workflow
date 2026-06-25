import type { IMConnectorService } from "./connector.js";
import { MemoryFeishuConnector } from "./memory-feishu-connector.js";
import type { FeishuAction, FeishuCallbackEvent, FeishuCallbackInput, FeishuChatMember, ListChatMembersInput, MentionUserInput, MentionUserResult, ReplyMessageInput, ReplyMessageResult, SendCardInput, SendCardResult, UpdateCardInput } from "./types.js";
import { redactSensitiveFields } from "../../common/redact.js";

export interface OpenApiFeishuConnectorOptions {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  fetch?: OpenApiFetch;
  now?: () => Date;
}

export interface OpenApiFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type OpenApiFetch = (url: string, init: { method: "GET" | "POST" | "PATCH"; headers: Record<string, string>; body?: string }) => Promise<OpenApiFetchResponse>;

export class OpenApiFeishuConnector implements IMConnectorService {
  private readonly baseUrl: string;
  private readonly fallback = new MemoryFeishuConnector();
  private readonly now: () => Date;
  private tokenCache?: { token: string; expiresAt: number };

  constructor(private readonly options: OpenApiFeishuConnectorOptions) {
    this.baseUrl = options.baseUrl ?? "https://open.feishu.cn";
    this.now = options.now ?? (() => new Date());
  }

  async sendCard(input: SendCardInput): Promise<SendCardResult> {
    if (!this.options.appId || !this.options.appSecret) {
      return sendFailed(input.target_id, "FEISHU_APP_ID or FEISHU_APP_SECRET is not configured.", false);
    }
    try {
      const token = await this.getTenantAccessToken();
      const receiveIdType = toReceiveIdType(input.target_type);
      const response = await this.request(`/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, "POST", token, {
        receive_id: input.target_id,
        msg_type: "interactive",
        content: JSON.stringify(createInteractiveCard(input))
      });
      const messageId = readDataString(response, "message_id");
      return {
        status: "sent",
        message_id: messageId,
        target_id: input.target_id,
        sent_at: this.now().toISOString()
      };
    } catch (error) {
      return sendFailed(input.target_id, error instanceof Error ? error.message : "Feishu OpenAPI send failed.", true, readOpenApiErrorDetails(error));
    }
  }

  async updateCard(input: UpdateCardInput): Promise<void> {
    const token = await this.getTenantAccessToken();
    await this.request(`/open-apis/im/v1/messages/${encodeURIComponent(input.message_id)}`, "PATCH", token, {
      msg_type: "interactive",
      content: JSON.stringify(
        createInteractiveCard({
          mode: input.mode,
          target_type: "chat",
          target_id: "",
          card_type: input.card_type,
          title: input.title ?? input.card_type,
          summary: input.summary ?? "",
          severity: input.severity ?? "medium",
          actions: input.actions,
          data: input.data,
          correlation_id: input.correlation_id,
          trace_id: input.trace_id,
          run_id: input.run_id
        })
      )
    });
  }

  async replyMessage(input: ReplyMessageInput): Promise<ReplyMessageResult> {
    try {
      const token = await this.getTenantAccessToken();
      const response = await this.request(`/open-apis/im/v1/messages/${encodeURIComponent(input.message_id)}/reply`, "POST", token, {
        msg_type: "text",
        content: JSON.stringify({ text: input.content })
      });
      return {
        status: "sent",
        message_id: readDataString(response, "message_id"),
        reply_to_message_id: input.message_id,
        sent_at: this.now().toISOString()
      };
    } catch (error) {
      return {
        status: "failed",
        reply_to_message_id: input.message_id,
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: error instanceof Error ? error.message : "Feishu OpenAPI reply failed.",
          retryable: true,
          severity: "error",
          details: {}
        }
      };
    }
  }

  mentionUser(input: MentionUserInput): MentionUserResult {
    return this.fallback.mentionUser(input);
  }

  async listChatMembers(input: ListChatMembersInput): Promise<FeishuChatMember[]> {
    const token = await this.getTenantAccessToken();
    const pageSize = clampPageSize(input.limit ?? 20);
    const response = await this.request(
      `/open-apis/im/v1/chats/${encodeURIComponent(input.chat_id)}/members?member_id_type=open_id&page_size=${pageSize}`,
      "GET",
      token
    );
    const data = response["data"];
    const items = data && typeof data === "object" ? (data as Record<string, unknown>)["items"] : undefined;
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .map((item) => readChatMember(item))
      .filter((member): member is FeishuChatMember => member !== undefined);
  }

  handleCallback(input: FeishuCallbackInput): Promise<FeishuCallbackEvent> {
    return this.fallback.handleCallback(input);
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > this.now().getTime()) {
      return this.tokenCache.token;
    }
    const response = await (this.options.fetch ?? defaultFetch)(`${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        app_id: this.options.appId,
        app_secret: this.options.appSecret
      })
    });
    const body = await readOpenApiResponse(response);
    const token = typeof body["tenant_access_token"] === "string" ? body["tenant_access_token"] : undefined;
    if (!token) {
      throw new Error("Feishu tenant access token missing.");
    }
    this.tokenCache = {
      token,
      expiresAt: this.now().getTime() + 60 * 60 * 1000
    };
    return token;
  }

  private async request(path: string, method: "GET" | "POST" | "PATCH", token: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await (this.options.fetch ?? defaultFetch)(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return readOpenApiResponse(response);
  }
}

function readChatMember(item: unknown): FeishuChatMember | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  const openId = record["member_id"] ?? record["open_id"];
  if (typeof openId !== "string" || !openId) {
    return undefined;
  }
  return {
    open_id: openId,
    name: typeof record["name"] === "string" ? record["name"] : undefined
  };
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function toReceiveIdType(targetType: SendCardInput["target_type"]): "chat_id" | "open_id" {
  return targetType === "user" ? "open_id" : "chat_id";
}

function createInteractiveCard(input: SendCardInput): Record<string, unknown> {
  const content = formatMarkdownContent(input);
  return {
    config: {
      wide_screen_mode: true
    },
    header: {
      title: {
        tag: "plain_text",
        content: input.title
      },
      template: severityTemplate(input.severity)
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content
        }
      },
      ...toActionElements(input.actions ?? [])
    ]
  };
}

function formatMarkdownContent(input: SendCardInput): string {
  const mentionPrefix = renderMentionPrefix(input.mentions ?? []);
  if (!mentionPrefix) {
    return input.summary;
  }
  return `${mentionPrefix}\n${input.summary}`;
}

function renderMentionPrefix(mentions: NonNullable<SendCardInput["mentions"]>): string {
  return mentions
    .filter((mention) => mention.type === "user" && isSafeMentionId(mention.id))
    .map((mention) => `<at id=${mention.id}></at>`)
    .join(" ");
}

function isSafeMentionId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/u.test(id);
}

function toActionElements(actions: FeishuAction[]): Record<string, unknown>[] {
  if (actions.length === 0) {
    return [];
  }
  return [
    {
      tag: "action",
      actions: actions.map((action) => ({
        tag: "button",
        text: {
          tag: "plain_text",
          content: action.label
        },
        type: action.type === "escalate" ? "danger" : "default",
        value: {
          action_type: action.type,
          value: action.value
        },
        url: action.url
      }))
    }
  ];
}

function severityTemplate(severity: SendCardInput["severity"]): string {
  if (severity === "critical" || severity === "high") {
    return "red";
  }
  if (severity === "medium") {
    return "orange";
  }
  return "blue";
}

async function readOpenApiResponse(response: OpenApiFetchResponse): Promise<Record<string, unknown>> {
  const parsed = await readResponseJson(response);
  if (!response.ok) {
    throw new FeishuOpenApiError(`Feishu OpenAPI returned ${response.status}`, {
      http_status: response.status,
      ...readFeishuBodyDetails(parsed)
    });
  }
  const body = parsed as Record<string, unknown>;
  if (body["code"] !== 0) {
    throw new FeishuOpenApiError(`Feishu OpenAPI returned code ${String(body["code"])}`, readFeishuBodyDetails(body));
  }
  return body;
}

async function readResponseJson(response: OpenApiFetchResponse): Promise<Record<string, unknown>> {
  const parsed = await response.json();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FeishuOpenApiError("Feishu OpenAPI returned invalid JSON.", {
      http_status: response.status
    });
  }
  return parsed as Record<string, unknown>;
}

function readDataString(body: Record<string, unknown>, key: string): string | undefined {
  const data = body["data"];
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function sendFailed(targetId: string, message: string, retryable: boolean, details: Record<string, unknown> = {}): SendCardResult {
  return {
    status: "failed",
    target_id: targetId,
    error: {
      code: retryable ? "UPSTREAM_UNAVAILABLE" : "MODEL_NOT_CONFIGURED",
      message,
      retryable,
      severity: retryable ? "error" : "warning",
      details
    }
  };
}

class FeishuOpenApiError extends Error {
  constructor(message: string, readonly details: Record<string, unknown>) {
    super(message);
    this.name = "FeishuOpenApiError";
  }
}

function readOpenApiErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof FeishuOpenApiError) {
    return redactSensitiveFields(error.details);
  }
  return {};
}

function readFeishuBodyDetails(body: Record<string, unknown>): Record<string, unknown> {
  return redactSensitiveFields({
    feishu_code: body["code"],
    feishu_msg: body["msg"] ?? body["message"],
    feishu_error: body["error"]
  });
}

async function defaultFetch(url: string, init: { method: "GET" | "POST" | "PATCH"; headers: Record<string, string>; body?: string }): Promise<OpenApiFetchResponse> {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    json: async () => response.json() as Promise<unknown>
  };
}
