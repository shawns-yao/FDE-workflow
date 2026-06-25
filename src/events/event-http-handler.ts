import type { ErrorObject, Environment } from "../common/contracts.js";
import type { FeishuCallbackHandler } from "../connectors/feishu/callback-handler.js";
import type { HeaderMap } from "./ingress-auth.js";
import type { EventIngressService, IngressSource } from "./event-ingress-service.js";

export interface EventHttpHandlerInput {
  method: string;
  path: string;
  headers: HeaderMap;
  rawBody: string;
  environment: Environment;
}

export interface EventHttpHandlerResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface EventHttpHandlerOptions {
  ingress: EventIngressService;
  feishuCallback?: FeishuCallbackHandler;
}

export class EventHttpHandler {
  constructor(private readonly options: EventHttpHandlerOptions) {}

  async handle(input: EventHttpHandlerInput): Promise<EventHttpHandlerResponse> {
    if (input.method.toUpperCase() !== "POST") {
      return {
        statusCode: 405,
        body: { error: validationError("Only POST is supported") }
      };
    }

    if (input.path === "/webhook/feishu") {
      return this.handleFeishu(input);
    }

    const source = sourceFromPath(input.path);
    if (!source) {
      return {
        statusCode: 404,
        body: { error: validationError(`Unsupported webhook path: ${input.path}`) }
      };
    }

    const body = parseBody(input.rawBody);
    if (!body) {
      return {
        statusCode: 400,
        body: { error: validationError("HTTP body must be a valid JSON object") }
      };
    }

    const result = await this.options.ingress.handle({
      source,
      headers: input.headers,
      environment: input.environment,
      body
    });

    return {
      statusCode: result.accepted ? 202 : 400,
      body: result as unknown as Record<string, unknown>
    };
  }

  private async handleFeishu(input: EventHttpHandlerInput): Promise<EventHttpHandlerResponse> {
    if (!this.options.feishuCallback) {
      return {
        statusCode: 404,
        body: { error: validationError("Feishu callback handler is not configured") }
      };
    }

    const result = await this.options.feishuCallback.handle({
      rawBody: input.rawBody,
      headers: input.headers,
      environment: input.environment,
      correlation_id: readHeader(input.headers, "x-fde-correlation-id") ?? "corr-feishu-callback",
      trace_id: readHeader(input.headers, "x-fde-trace-id") ?? "trace-feishu-callback",
      run_id: readHeader(input.headers, "x-fde-run-id") ?? "run-feishu-callback"
    });

    if (result.challenge) {
      return {
        statusCode: 200,
        body: { challenge: result.challenge }
      };
    }

    return {
      statusCode: result.accepted ? 202 : 400,
      body: result as unknown as Record<string, unknown>
    };
  }
}

function sourceFromPath(path: string): IngressSource | undefined {
  if (path === "/webhook/gitlab") {
    return "gitlab";
  }
  if (path === "/webhook/tekton") {
    return "tekton";
  }
  if (path === "/webhook/argocd") {
    return "argocd";
  }
  if (path === "/webhook/kubernetes") {
    return "kubernetes";
  }
  return undefined;
}

function parseBody(rawBody: string): Record<string, unknown> | undefined {
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

function readHeader(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function validationError(message: string): ErrorObject {
  return {
    code: "SCHEMA_VALIDATION_FAILED",
    message,
    retryable: false,
    severity: "error",
    details: {}
  };
}
