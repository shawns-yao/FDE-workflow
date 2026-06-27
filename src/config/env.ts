import type { Environment, ErrorObject } from "../common/contracts.js";

export type FdeEventBackend = "redis" | "memory";
export type FeishuEventMode = "websocket" | "http_callback" | "disabled";

export interface FdeRuntimeConfig {
  environment: Environment;
  event_backend: FdeEventBackend;
  production: boolean;
  feishu: {
    event_mode: FeishuEventMode;
  };
  http: {
    host: string;
    port: number;
    max_body_bytes: number;
    request_timeout_ms: number;
  };
}

export class FdeRuntimeConfigError extends Error {
  constructor(readonly error: ErrorObject) {
    super(error.message);
    this.name = "FdeRuntimeConfigError";
  }
}

export function loadFdeRuntimeConfig(env: NodeJS.ProcessEnv = process.env): FdeRuntimeConfig {
  const environment = readEnvironment(env.FDE_ENVIRONMENT);
  const eventBackend = readEventBackend(env.FDE_EVENT_BACKEND);
  const config: FdeRuntimeConfig = {
    environment,
    event_backend: eventBackend,
    production: environment === "prod",
    feishu: {
      event_mode: readFeishuEventMode(env.FEISHU_EVENT_MODE)
    },
    http: {
      host: env.FDE_HTTP_HOST?.trim() || "0.0.0.0",
      port: readPort(env.FDE_HTTP_PORT, 3000),
      max_body_bytes: readPositiveInteger(env.FDE_HTTP_MAX_BODY_BYTES, 1024 * 1024),
      request_timeout_ms: readPositiveInteger(env.FDE_HTTP_REQUEST_TIMEOUT_MS, 5000)
    }
  };

  if (config.production) {
    validateProductionEnv(env, config);
  }

  return config;
}

function validateProductionEnv(env: NodeJS.ProcessEnv, config: FdeRuntimeConfig): void {
  const missingKeys: string[] = [];
  const invalidValues: Record<string, string> = {};

  requireKey(env, "FEISHU_APP_ID", missingKeys);
  requireKey(env, "FEISHU_APP_SECRET", missingKeys);
  requireAnyKey(env, ["FEISHU_TEST_CHAT_ID", "FEISHU_DEFAULT_CHAT_ID"], "FEISHU_TEST_CHAT_ID or FEISHU_DEFAULT_CHAT_ID", missingKeys);

  if (config.feishu.event_mode === "http_callback") {
    requireKey(env, "FEISHU_CALLBACK_VERIFICATION_TOKEN", missingKeys);
    requireAnyKey(env, ["FEISHU_CALLBACK_SIGNING_SECRET", "FEISHU_CALLBACK_ENCRYPT_KEY"], "FEISHU_CALLBACK_SIGNING_SECRET", missingKeys);
  }

  if (!env.REDIS_URL && !env.REDIS_HOST) {
    missingKeys.push("REDIS_URL");
  }

  if (config.event_backend !== "redis") {
    invalidValues["FDE_EVENT_BACKEND"] = "prod requires redis";
  }

  if ((env.FEISHU_MODE ?? "openapi_bot") !== "openapi_bot") {
    invalidValues["FEISHU_MODE"] = "prod requires openapi_bot";
  }

  if (missingKeys.length > 0 || Object.keys(invalidValues).length > 0) {
    throw new FdeRuntimeConfigError({
      code: "CONFIGURATION_INVALID",
      message: "FDE production environment configuration is invalid.",
      retryable: false,
      severity: "error",
      details: {
        missing_keys: missingKeys,
        invalid_values: invalidValues
      }
    });
  }
}

function requireKey(env: NodeJS.ProcessEnv, key: string, missingKeys: string[]): void {
  if (!env[key]?.trim()) {
    missingKeys.push(key);
  }
}

function requireAnyKey(env: NodeJS.ProcessEnv, keys: string[], displayKey: string, missingKeys: string[]): void {
  if (!keys.some((key) => Boolean(env[key]?.trim()))) {
    missingKeys.push(displayKey);
  }
}

function readEnvironment(value: string | undefined): Environment {
  if (!value) {
    return "dev";
  }
  if (value === "dev" || value === "test" || value === "prod") {
    return value;
  }
  throw new FdeRuntimeConfigError({
    code: "CONFIGURATION_INVALID",
    message: "FDE_ENVIRONMENT must be dev, test, or prod.",
    retryable: false,
    severity: "error",
    details: {
      value
    }
  });
}

function readEventBackend(value: string | undefined): FdeEventBackend {
  if (!value) {
    return "redis";
  }
  if (value === "redis" || value === "memory") {
    return value;
  }
  throw new FdeRuntimeConfigError({
    code: "CONFIGURATION_INVALID",
    message: "FDE_EVENT_BACKEND must be redis or memory.",
    retryable: false,
    severity: "error",
    details: {
      value
    }
  });
}

function readFeishuEventMode(value: string | undefined): FeishuEventMode {
  if (!value) {
    return "websocket";
  }
  if (value === "websocket" || value === "http_callback" || value === "disabled") {
    return value;
  }
  throw new FdeRuntimeConfigError({
    code: "CONFIGURATION_INVALID",
    message: "FEISHU_EVENT_MODE must be websocket, http_callback, or disabled.",
    retryable: false,
    severity: "error",
    details: {
      value
    }
  });
}

function readPort(value: string | undefined, fallback: number): number {
  const port = readPositiveInteger(value, fallback);
  if (port > 65535) {
    throw new FdeRuntimeConfigError({
      code: "CONFIGURATION_INVALID",
      message: "FDE_HTTP_PORT must be between 1 and 65535.",
      retryable: false,
      severity: "error",
      details: {
        value
      }
    });
  }
  return port;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new FdeRuntimeConfigError({
      code: "CONFIGURATION_INVALID",
      message: "Runtime numeric environment value must be a positive integer.",
      retryable: false,
      severity: "error",
      details: {
        value
      }
    });
  }
  return parsed;
}
