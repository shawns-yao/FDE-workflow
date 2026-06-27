import { createHmac, timingSafeEqual } from "node:crypto";
import type { ErrorObject } from "../../common/contracts.js";
import { loadZhMessages } from "../../i18n/messages.js";

export interface FeishuCallbackVerificationInput {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  verificationToken?: string;
  signingSecret?: string;
}

export interface FeishuCallbackVerificationResult {
  ok: boolean;
  challenge?: string;
  error?: ErrorObject;
}

export function verifyFeishuCallback(input: FeishuCallbackVerificationInput): FeishuCallbackVerificationResult {
  const tokenResult = verifyChallengeToken(input.rawBody, input.verificationToken);
  if (tokenResult) {
    return tokenResult;
  }

  if (!input.signingSecret) {
    return { ok: true };
  }

  const timestamp = getHeader(input.headers, "x-lark-request-timestamp");
  const signature = getHeader(input.headers, "x-lark-signature");
  if (!timestamp || !signature) {
    return authenticationError(loadZhMessages().feishu.callback.missing_signature_headers);
  }

  const expected = createHmac("sha256", `${timestamp}\n${input.signingSecret}`).update(input.rawBody).digest("base64");
  if (!safeEqual(signature, expected)) {
    return authenticationError(loadZhMessages().feishu.callback.signature_verification_failed);
  }

  return { ok: true };
}

function verifyChallengeToken(rawBody: string, verificationToken?: string): FeishuCallbackVerificationResult | undefined {
  const parsed = parseJson(rawBody);
  if (!parsed || parsed["type"] !== "url_verification") {
    return undefined;
  }
  if (verificationToken && parsed["token"] !== verificationToken) {
    return authenticationError(loadZhMessages().feishu.callback.url_verification_token_failed);
  }
  return {
    ok: true,
    challenge: typeof parsed["challenge"] === "string" ? parsed["challenge"] : undefined
  };
}

function parseJson(rawBody: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function authenticationError(message: string): FeishuCallbackVerificationResult {
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
