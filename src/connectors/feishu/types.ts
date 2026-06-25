import type { ArtifactRef, Environment, ErrorObject } from "../../common/contracts.js";

export type FeishuMode = "webhook_bot" | "openapi_bot";
export type FeishuTargetType = "chat" | "group" | "user";
export type FeishuCardType =
  | "environment_scan_report"
  | "diagnosis_notification"
  | "pipeline_build_notification"
  | "mr_review_report"
  | "escalation_notice"
  | "daily_report"
  | "custom";

export type FeishuActionType = "open_url" | "acknowledge" | "claim" | "mark_fixed" | "escalate" | "open_artifact";

export interface FeishuMention {
  type: "user" | "group";
  id: string;
  reason: string;
}

export interface FeishuAction {
  type: FeishuActionType;
  label: string;
  url?: string;
  value?: string;
}

export interface SendCardInput {
  mode: FeishuMode;
  target_type: FeishuTargetType;
  target_id: string;
  mentions?: FeishuMention[];
  card_type: FeishuCardType;
  title: string;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  actions?: FeishuAction[];
  data: Record<string, unknown>;
  correlation_id: string;
  trace_id: string;
  run_id: string;
}

export interface UpdateCardInput {
  mode: "openapi_bot";
  message_id: string;
  card_type: FeishuCardType;
  title?: string;
  summary?: string;
  severity?: "low" | "medium" | "high" | "critical";
  actions?: FeishuAction[];
  data: Record<string, unknown>;
  correlation_id: string;
  trace_id: string;
  run_id: string;
}

export interface ReplyMessageInput {
  message_id: string;
  content: string;
  correlation_id: string;
  trace_id: string;
  run_id: string;
}

export interface MentionUserInput {
  user_id: string;
  content: string;
  display_name?: string;
}

export interface ListChatMembersInput {
  chat_id: string;
  limit?: number;
}

export interface FeishuChatMember {
  open_id: string;
  name?: string;
}

export interface SendCardResult {
  status: "sent" | "failed";
  message_id?: string;
  target_id: string;
  sent_at?: string;
  error?: ErrorObject;
}

export interface ReplyMessageResult {
  status: "sent" | "failed";
  message_id?: string;
  reply_to_message_id: string;
  sent_at?: string;
  error?: ErrorObject;
}

export interface MentionUserResult {
  type: "mention";
  user_id: string;
  display_name?: string;
  fragment: Record<string, unknown>;
}

export interface FeishuCallbackInput {
  raw: Record<string, unknown>;
  environment: Environment;
  correlation_id: string;
  trace_id: string;
  run_id: string;
}

export interface FeishuCallbackEvent {
  type: "feishu.card.action_clicked" | "feishu.message.replied";
  message_id: string;
  environment: Environment;
  action?: FeishuAction;
  operator?: string;
  raw_callback_excerpt: string;
  correlation_id: string;
  trace_id: string;
  run_id: string;
  artifact_refs?: ArtifactRef[];
}
