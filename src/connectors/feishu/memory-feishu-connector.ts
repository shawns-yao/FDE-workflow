import { createId } from "../../common/ids.js";
import { redactSensitiveFields } from "../../common/redact.js";
import { loadZhMessages } from "../../i18n/messages.js";
import type { FeishuActionType, FeishuCallbackEvent, FeishuCallbackInput, MentionUserInput, MentionUserResult, ReplyMessageInput, ReplyMessageResult, SendCardInput, SendCardResult, UpdateCardInput } from "./types.js";
import type { FeishuCardRecord, IMConnectorService } from "./connector.js";

const webhookAllowedActions = new Set<FeishuActionType>(["open_url", "open_artifact"]);

export class MemoryFeishuConnector implements IMConnectorService {
  readonly sentCards: FeishuCardRecord[] = [];
  readonly replies: ReplyMessageResult[] = [];
  readonly callbacks: FeishuCallbackEvent[] = [];

  async sendCard(input: SendCardInput): Promise<SendCardResult> {
    const validationError = validateWebhookActions(input);
    if (validationError) {
      return {
        status: "failed",
        target_id: input.target_id,
        error: validationError
      };
    }

    const messageId = createId("notification");
    const sentAt = new Date().toISOString();
    this.sentCards.push({
      ...input,
      message_id: messageId,
      sent_at: sentAt
    });

    return {
      status: "sent",
      message_id: messageId,
      target_id: input.target_id,
      sent_at: sentAt
    };
  }

  async updateCard(_input: UpdateCardInput): Promise<void> {
    return;
  }

  async replyMessage(input: ReplyMessageInput): Promise<ReplyMessageResult> {
    const messageId = createId("notification");
    const sentAt = new Date().toISOString();
    const result: ReplyMessageResult = {
      status: "sent",
      message_id: messageId,
      reply_to_message_id: input.message_id,
      sent_at: sentAt
    };
    this.replies.push(result);
    return result;
  }

  mentionUser(input: MentionUserInput): MentionUserResult {
    return {
      type: "mention",
      user_id: input.user_id,
      display_name: input.display_name,
      fragment: {
        tag: "at",
        user_id: input.user_id,
        text: input.content
      }
    };
  }

  async handleCallback(input: FeishuCallbackInput): Promise<FeishuCallbackEvent> {
    const rawExcerpt = JSON.stringify(redactSensitiveFields(input.raw)).slice(0, 1024);
    const callback: FeishuCallbackEvent = {
      type: input.raw["action"] ? "feishu.card.action_clicked" : "feishu.message.replied",
      message_id: String(input.raw["message_id"] ?? ""),
      environment: input.environment,
      action: input.raw["action"] as never,
      operator: input.raw["operator"] ? String(input.raw["operator"]) : undefined,
      latest_reply: readReplyText(input.raw),
      raw_callback_excerpt: rawExcerpt,
      correlation_id: input.correlation_id,
      trace_id: input.trace_id,
      run_id: input.run_id
    };
    this.callbacks.push(callback);
    return callback;
  }
}

function validateWebhookActions(input: SendCardInput) {
  if (input.mode !== "webhook_bot") {
    return undefined;
  }
  const invalidActions = (input.actions ?? []).filter((action) => !webhookAllowedActions.has(action.type));
  if (invalidActions.length === 0) {
    return undefined;
  }
  return {
    code: "PERMISSION_DENIED",
    message: loadZhMessages().feishu.webhook.interactive_action_not_supported,
    retryable: false,
    severity: "error",
    details: {
      invalid_actions: invalidActions.map((action) => action.type)
    }
  } as const;
}

function readReplyText(raw: Record<string, unknown>): string | undefined {
  const explicit = readString(raw["latest_reply"]) ?? readString(raw["text"]);
  if (explicit) {
    return explicit;
  }

  const content = readString(raw["content"]);
  if (!content) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return content;
    }
    return readString((parsed as Record<string, unknown>)["text"]) ?? content;
  } catch {
    return content;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
