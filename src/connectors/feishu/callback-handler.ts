import type { ErrorObject, Environment } from "../../common/contracts.js";
import { loadZhMessages } from "../../i18n/messages.js";
import type { EventPublishResult, EventPublisherService } from "../../events/event-publisher.js";
import { verifyFeishuCallback } from "./callback-security.js";
import { FeishuCallbackEventPublisher } from "./callback-event-publisher.js";
import type { IMConnectorService } from "./connector.js";
import type { FeishuCallbackEvent } from "./types.js";

export interface FeishuCallbackHandlerOptions {
  verificationToken?: string;
  signingSecret?: string;
}

export interface FeishuCallbackHandleInput {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  environment: Environment;
  correlation_id: string;
  trace_id: string;
  run_id: string;
}

export interface FeishuCallbackHandleResult {
  accepted: boolean;
  challenge?: string;
  callback?: FeishuCallbackEvent;
  publish_result?: EventPublishResult;
  error?: ErrorObject;
}

export class FeishuCallbackHandler {
  private readonly callbackPublisher: FeishuCallbackEventPublisher;

  constructor(
    private readonly connector: IMConnectorService,
    private readonly eventPublisher: EventPublisherService,
    private readonly options: FeishuCallbackHandlerOptions
  ) {
    this.callbackPublisher = new FeishuCallbackEventPublisher(eventPublisher);
  }

  async handle(input: FeishuCallbackHandleInput): Promise<FeishuCallbackHandleResult> {
    const verification = verifyFeishuCallback({
      rawBody: input.rawBody,
      headers: input.headers,
      verificationToken: this.options.verificationToken,
      signingSecret: this.options.signingSecret
    });

    if (!verification.ok) {
      return {
        accepted: false,
        error: verification.error
      };
    }

    if (verification.challenge) {
      return {
        accepted: true,
        challenge: verification.challenge
      };
    }

    const raw = parseRawBody(input.rawBody);
    if (!raw) {
      return {
        accepted: false,
        error: {
          code: "SCHEMA_VALIDATION_FAILED",
          message: loadZhMessages().feishu.callback.invalid_json_body,
          retryable: false,
          severity: "error",
          details: {}
        }
      };
    }

    const callback = await this.connector.handleCallback({
      raw,
      environment: input.environment,
      correlation_id: input.correlation_id,
      trace_id: input.trace_id,
      run_id: input.run_id
    });
    const publishResult = await this.callbackPublisher.publish(callback);

    return {
      accepted: publishResult.published,
      callback,
      publish_result: publishResult,
      error: publishResult.published ? undefined : publishResult.errors[0]
    };
  }
}

function parseRawBody(rawBody: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
