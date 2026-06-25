import { timingSafeEqual } from "node:crypto";
import type { ErrorObject } from "../common/contracts.js";

export interface IngressAuthResult {
  ok: boolean;
  error?: ErrorObject;
}

export type HeaderMap = Record<string, string | string[] | undefined>;

export function verifyGitLabWebhookToken(headers: HeaderMap, expectedToken: string | undefined): IngressAuthResult {
  return verifyStaticToken(readHeader(headers, "x-gitlab-token"), expectedToken, "GitLab webhook token 校验失败");
}

export function verifyArgoCdWebhookToken(headers: HeaderMap, expectedToken: string | undefined): IngressAuthResult {
  const authorization = readHeader(headers, "authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : readHeader(headers, "x-argocd-token");
  return verifyStaticToken(token, expectedToken, "ArgoCD webhook token 校验失败");
}

export function verifyTektonReportToken(headers: HeaderMap, expectedToken: string | undefined): IngressAuthResult {
  return verifyStaticToken(readHeader(headers, "x-fde-token"), expectedToken, "Tekton report token 校验失败");
}

function verifyStaticToken(actual: string | undefined, expected: string | undefined, message: string): IngressAuthResult {
  if (!expected) {
    return authError("入口认证 token 未配置");
  }
  if (!actual || !safeEqual(actual, expected)) {
    return authError(message);
  }
  return { ok: true };
}

function readHeader(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function authError(message: string): IngressAuthResult {
  return {
    ok: false,
    error: {
      code: "AUTHENTICATION_FAILED",
      message,
      retryable: false,
      severity: "error",
      details: {}
    }
  };
}
