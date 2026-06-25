import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Environment, ErrorObject } from "../common/contracts.js";
import type { EventHttpHandler, EventHttpHandlerResponse } from "../events/event-http-handler.js";
import type { HeaderMap } from "../events/ingress-auth.js";

export interface FdeHttpServerOptions {
  environment: Environment;
  eventHandler: Pick<EventHttpHandler, "handle">;
  readyCheck?: () => Promise<FdeReadinessState> | FdeReadinessState;
  maxBodyBytes?: number;
  requestTimeoutMs?: number;
}

export interface FdeReadinessState {
  ready: boolean;
  checks?: Record<string, string>;
}

class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBodyBytes: number) {
    super("HTTP request body exceeds configured limit.");
    this.name = "RequestBodyTooLargeError";
  }
}

export function createFdeHttpServer(options: FdeHttpServerOptions): Server {
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, options);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        writeJson(response, 413, {
          error: {
            code: "SCHEMA_VALIDATION_FAILED",
            message: error.message,
            retryable: false,
            severity: "error",
            details: {
              max_body_bytes: error.maxBodyBytes
            }
          }
        });
        return;
      }
      writeJson(response, 500, {
        error: toInternalError(error)
      });
    }
  });
  server.requestTimeout = options.requestTimeoutMs ?? 5000;
  server.headersTimeout = Math.max(server.requestTimeout + 1000, 2000);
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: FdeHttpServerOptions
): Promise<void> {
  const method = request.method ?? "GET";
  const pathname = readPathname(request.url);

  if (method.toUpperCase() === "GET" && pathname === "/health") {
    writeJson(response, 200, {
      status: "ok",
      service: "fde-workstation",
      environment: options.environment
    });
    return;
  }

  if (method.toUpperCase() === "GET" && pathname === "/ready") {
    const readiness = await readReadiness(options.readyCheck);
    writeJson(response, readiness.ready ? 200 : 503, {
      status: readiness.ready ? "ready" : "not_ready",
      service: "fde-workstation",
      environment: options.environment,
      checks: readiness.checks ?? {}
    });
    return;
  }

  const rawBody = await readBody(request, options.maxBodyBytes ?? 1024 * 1024);
  const handlerResponse = await options.eventHandler.handle({
    method,
    path: toInternalWebhookPath(pathname),
    headers: request.headers as HeaderMap,
    rawBody,
    environment: options.environment
  });

  writeJson(response, handlerResponse.statusCode, handlerResponse.body);
}

function readPathname(url: string | undefined): string {
  return new URL(url ?? "/", "http://127.0.0.1").pathname;
}

function toInternalWebhookPath(pathname: string): string {
  if (pathname === "/webhook/feishu/callback") {
    return "/webhook/feishu";
  }
  return pathname;
}

function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let rejected = false;
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBodyBytes) {
        if (!rejected) {
          rejected = true;
          reject(new RequestBodyTooLargeError(maxBodyBytes));
        }
        return;
      }
      if (!rejected) {
        chunks.push(buffer);
      }
    });
    request.on("error", reject);
    request.on("end", () => {
      if (rejected) {
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

async function readReadiness(readyCheck?: () => Promise<FdeReadinessState> | FdeReadinessState): Promise<FdeReadinessState> {
  if (!readyCheck) {
    return { ready: true, checks: {} };
  }
  try {
    return await readyCheck();
  } catch (error) {
    return {
      ready: false,
      checks: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: EventHttpHandlerResponse["body"]): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function toInternalError(error: unknown): ErrorObject {
  return {
    code: "UPSTREAM_UNAVAILABLE",
    message: error instanceof Error ? error.message : "HTTP server request handling failed.",
    retryable: true,
    severity: "error",
    details: {
      component: "fde-http-server"
    }
  };
}
