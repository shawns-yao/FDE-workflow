import * as Lark from "@larksuiteoapi/node-sdk";
import type { Environment } from "../../common/contracts.js";
import { createId } from "../../common/ids.js";
import { redactSensitiveFields } from "../../common/redact.js";
import type { EventPublishResult, EventPublisherService } from "../../events/event-publisher.js";
import { FeishuCallbackEventPublisher } from "./callback-event-publisher.js";
import type { FeishuAction, FeishuActionType, FeishuCallbackEvent } from "./types.js";

const actionTypes = new Set<FeishuActionType>([
  "open_url",
  "acknowledge",
  "claim",
  "mark_fixed",
  "escalate",
  "open_artifact"
]);
const emptyRecord: Record<string, unknown> = {};
export type FeishuLongConnectionEventType = "im.message.receive_v1" | "card.action.trigger";

export interface FeishuLongConnectionIngressLog {
  status: "feishu_event_ingress_received";
  feishu_event_type: FeishuLongConnectionEventType;
  cloud_event_type: FeishuCallbackEvent["type"];
  message_id: string;
  chat_id?: string;
  action_type?: FeishuActionType;
  operator_present: boolean;
  correlation_id: string;
  trace_id: string;
  run_id: string;
  received_at: string;
}

export type FeishuLongConnectionEventLogger = (entry: FeishuLongConnectionIngressLog) => void;

export interface FeishuLongConnectionContext {
  environment: Environment;
  correlation_id?: string;
  trace_id?: string;
  run_id?: string;
}

export interface FeishuLongConnectionClientOptions {
  appId: string;
  appSecret: string;
  environment: Environment;
  eventPublisher: EventPublisherService;
  loggerLevel?: Lark.LoggerLevel;
  handshakeTimeoutMs?: number;
  eventLogger?: FeishuLongConnectionEventLogger;
}

export interface FeishuLongConnectionClientLike {
  start(): Promise<void>;
  close(): Promise<void>;
}

export class FeishuLongConnectionClient implements FeishuLongConnectionClientLike {
  private readonly callbackPublisher: FeishuCallbackEventPublisher;
  private wsClient?: Lark.WSClient;
  private started = false;

  constructor(private readonly options: FeishuLongConnectionClientOptions) {
    this.callbackPublisher = new FeishuCallbackEventPublisher(options.eventPublisher);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    if (!this.options.appId || !this.options.appSecret) {
      throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required for Feishu long connection.");
    }

    const dispatcher = new Lark.EventDispatcher({
      loggerLevel: this.options.loggerLevel ?? Lark.LoggerLevel.info
    }).register({
      "im.message.receive_v1": async (data: unknown) => {
        const callback = normalizeFeishuMessageReceiveEvent(data, this.createContext());
        this.logIngressEvent("im.message.receive_v1", data, callback);
        await this.publish(callback);
      },
      "card.action.trigger": async (data: unknown) => {
        const callback = normalizeFeishuCardActionEvent(data, this.createContext());
        this.logIngressEvent("card.action.trigger", data, callback);
        await this.publish(callback);
      }
    } as Record<string, (data: unknown) => Promise<void>>);

    this.wsClient = new Lark.WSClient({
      appId: this.options.appId,
      appSecret: this.options.appSecret,
      loggerLevel: this.options.loggerLevel ?? Lark.LoggerLevel.info,
      source: "fde-workstation",
      handshakeTimeoutMs: this.options.handshakeTimeoutMs
    });
    this.started = true;
    await this.wsClient.start({ eventDispatcher: dispatcher });
  }

  async close(): Promise<void> {
    this.wsClient?.close({ force: true });
    this.wsClient = undefined;
    this.started = false;
  }

  getStatus(): unknown {
    return this.wsClient?.getConnectionStatus();
  }

  private createContext(): FeishuLongConnectionContext {
    return {
      environment: this.options.environment,
      correlation_id: createId("corr"),
      trace_id: createId("trace"),
      run_id: createId("run")
    };
  }

  private async publish(callback: FeishuCallbackEvent): Promise<EventPublishResult> {
    return this.callbackPublisher.publish(callback);
  }

  private logIngressEvent(type: FeishuLongConnectionEventType, raw: unknown, callback: FeishuCallbackEvent): void {
    const logger = this.options.eventLogger ?? defaultEventLogger;
    logger(createFeishuLongConnectionIngressLog(type, raw, callback));
  }
}

export function publishFeishuLongConnectionEvent(
  eventPublisher: EventPublisherService,
  callback: FeishuCallbackEvent
): Promise<EventPublishResult> {
  return new FeishuCallbackEventPublisher(eventPublisher).publish(callback);
}

export function createFeishuLongConnectionIngressLog(
  type: FeishuLongConnectionEventType,
  raw: unknown,
  callback: FeishuCallbackEvent
): FeishuLongConnectionIngressLog {
  return {
    status: "feishu_event_ingress_received",
    feishu_event_type: type,
    cloud_event_type: callback.type,
    message_id: callback.message_id,
    chat_id: readFeishuChatId(raw),
    action_type: callback.action?.type,
    operator_present: Boolean(callback.operator),
    correlation_id: callback.correlation_id,
    trace_id: callback.trace_id,
    run_id: callback.run_id,
    received_at: new Date().toISOString()
  };
}

export function normalizeFeishuMessageReceiveEvent(
  raw: unknown,
  context: FeishuLongConnectionContext
): FeishuCallbackEvent {
  const root = readRecord(raw) ?? emptyRecord;
  const event = readRecord(root["event"]) ?? root;
  const message = readRecord(event["message"]);
  const sender = readRecord(event["sender"]);
  const senderId = readRecord(sender?.["sender_id"]);

  return {
    type: "feishu.message.replied",
    message_id: readString(message?.["message_id"]) ?? readString(message?.["open_message_id"]) ?? readString(event["event_id"]) ?? createId("notification"),
    environment: context.environment,
    operator: readString(senderId?.["open_id"]) ?? readString(senderId?.["user_id"]) ?? readString(sender?.["open_id"]),
    latest_reply: readMessageText(message),
    raw_callback_excerpt: createRawExcerpt(raw),
    correlation_id: context.correlation_id ?? createId("corr"),
    trace_id: context.trace_id ?? createId("trace"),
    run_id: context.run_id ?? createId("run")
  };
}

export function normalizeFeishuCardActionEvent(
  raw: unknown,
  context: FeishuLongConnectionContext
): FeishuCallbackEvent {
  const root = readRecord(raw) ?? emptyRecord;
  const event = readRecord(root["event"]) ?? root;
  const cardContext = readRecord(event["context"]);
  const operator = readRecord(event["operator"]);
  const action = readRecord(event["action"]);

  return {
    type: "feishu.card.action_clicked",
    message_id:
      readString(cardContext?.["open_message_id"]) ??
      readString(event["open_message_id"]) ??
      readString(event["message_id"]) ??
      createId("notification"),
    environment: context.environment,
    action: normalizeFeishuAction(action),
    operator:
      readString(operator?.["open_id"]) ??
      readString(operator?.["user_id"]) ??
      readString(event["open_id"]) ??
      readString(event["user_id"]),
    raw_callback_excerpt: createRawExcerpt(raw),
    correlation_id: context.correlation_id ?? createId("corr"),
    trace_id: context.trace_id ?? createId("trace"),
    run_id: context.run_id ?? createId("run")
  };
}

function normalizeFeishuAction(action: Record<string, unknown> | undefined): FeishuAction | undefined {
  if (!action) {
    return undefined;
  }

  const value = action["value"];
  const valueRecord = readRecord(value);
  const actionType = readActionType(
    readString(valueRecord?.["action_type"]) ??
    readString(valueRecord?.["type"]) ??
    readString(action["name"])
  );
  if (!actionType) {
    return undefined;
  }

  const normalized: FeishuAction = {
    type: actionType,
    label: readString(action["name"]) ?? readString(action["tag"]) ?? actionType,
    value: readActionValue(valueRecord?.["value"] ?? value)
  };
  const url = readString(valueRecord?.["url"]);
  if (url) {
    normalized.url = url;
  }
  return normalized;
}

function readActionType(value: string | undefined): FeishuActionType | undefined {
  return value && actionTypes.has(value as FeishuActionType) ? value as FeishuActionType : undefined;
}

function readActionValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null || typeof value === "object") {
    return undefined;
  }
  return String(value);
}

function readMessageText(message: Record<string, unknown> | undefined): string | undefined {
  const content = readString(message?.["content"]);
  if (!content) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    const record = readRecord(parsed);
    return readString(record?.["text"]);
  } catch {
    return content;
  }
}

function createRawExcerpt(raw: unknown): string {
  return JSON.stringify(redactSensitiveFields(raw)).slice(0, 1024);
}

function readFeishuChatId(raw: unknown): string | undefined {
  const root = readRecord(raw) ?? emptyRecord;
  const event = readRecord(root["event"]) ?? root;
  const message = readRecord(event["message"]);
  const context = readRecord(event["context"]);
  return readString(message?.["chat_id"])
    ?? readString(context?.["open_chat_id"])
    ?? readString(event["chat_id"])
    ?? readString(event["open_chat_id"]);
}

function defaultEventLogger(entry: FeishuLongConnectionIngressLog): void {
  console.log(JSON.stringify(entry));
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
