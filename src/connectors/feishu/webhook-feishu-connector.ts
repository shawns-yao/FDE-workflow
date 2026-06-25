import { createHmac } from "node:crypto";
import { createId } from "../../common/ids.js";
import type { FeishuCallbackEvent, FeishuCallbackInput, ReplyMessageInput, ReplyMessageResult, SendCardInput, SendCardResult, UpdateCardInput } from "./types.js";
import { MemoryFeishuConnector } from "./memory-feishu-connector.js";
import type { IMConnectorService } from "./connector.js";

export interface WebhookFeishuConnectorOptions {
  webhookUrl: string;
  webhookSecret?: string;
  fetch?: WebhookFetch;
  now?: () => Date;
}

export interface WebhookFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type WebhookFetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<WebhookFetchResponse>;

export class WebhookFeishuConnector implements IMConnectorService {
  private readonly fallback = new MemoryFeishuConnector();
  private readonly now: () => Date;

  constructor(private readonly options: WebhookFeishuConnectorOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async sendCard(input: SendCardInput): Promise<SendCardResult> {
    if (!this.options.webhookUrl) {
      return {
        status: "failed",
        target_id: input.target_id,
        error: {
          code: "MODEL_NOT_CONFIGURED",
          message: "FEISHU_WEBHOOK_URL is not configured.",
          retryable: false,
          severity: "warning",
          details: {}
        }
      };
    }

    const validation = await this.fallback.sendCard(input);
    if (validation.status === "failed") {
      return validation;
    }

    const payload = createWebhookPayload(input, this.options.webhookSecret, this.now());
    try {
      const response = await (this.options.fetch ?? defaultFetch)(this.options.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        return failed(input.target_id, `Feishu webhook returned ${response.status}`, true);
      }
      const body = await response.json();
      const code = extractFeishuCode(body);
      if (code !== 0) {
        return failed(input.target_id, "Feishu webhook response indicates failure", true, { response: body });
      }
      return {
        status: "sent",
        message_id: createId("notification"),
        target_id: input.target_id,
        sent_at: this.now().toISOString()
      };
    } catch (error) {
      return failed(input.target_id, error instanceof Error ? error.message : "Feishu webhook request failed", true);
    }
  }

  async updateCard(_input: UpdateCardInput): Promise<void> {
    return;
  }

  replyMessage(input: ReplyMessageInput): Promise<ReplyMessageResult> {
    return this.fallback.replyMessage(input);
  }

  mentionUser(input: Parameters<IMConnectorService["mentionUser"]>[0]) {
    return this.fallback.mentionUser(input);
  }

  handleCallback(input: FeishuCallbackInput): Promise<FeishuCallbackEvent> {
    return this.fallback.handleCallback(input);
  }
}

function createWebhookPayload(input: SendCardInput, secret: string | undefined, now: Date): Record<string, unknown> {
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  return {
    msg_type: "interactive",
    timestamp: secret ? timestamp : undefined,
    sign: secret ? createWebhookSign(timestamp, secret) : undefined,
    card: {
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
            content: input.summary
          }
        },
        ...toActionElements(input)
      ]
    }
  };
}

function createWebhookSign(timestamp: string, secret: string): string {
  return createHmac("sha256", `${timestamp}\n${secret}`).digest("base64");
}

function toActionElements(input: SendCardInput): Record<string, unknown>[] {
  const actions = (input.actions ?? []).filter((action) => action.type === "open_url" || action.type === "open_artifact");
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
        url: action.url,
        type: "default"
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

function extractFeishuCode(body: unknown): number {
  if (!body || typeof body !== "object") {
    return -1;
  }
  const record = body as Record<string, unknown>;
  const code = record["StatusCode"] ?? record["code"];
  return typeof code === "number" ? code : -1;
}

function failed(targetId: string, message: string, retryable: boolean, details: Record<string, unknown> = {}): SendCardResult {
  return {
    status: "failed",
    target_id: targetId,
    error: {
      code: "UPSTREAM_UNAVAILABLE",
      message,
      retryable,
      severity: "error",
      details
    }
  };
}

async function defaultFetch(url: string, init: { method: "POST"; headers: Record<string, string>; body: string }): Promise<WebhookFetchResponse> {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    json: async () => response.json() as Promise<unknown>
  };
}
