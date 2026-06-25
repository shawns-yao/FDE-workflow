import type { SendCardResult } from "./types.js";
import { OpenApiFeishuConnector, type OpenApiFetch } from "./openapi-feishu-connector.js";

export type FeishuSmokeEnv = Partial<Record<string, string>>;

export interface FeishuOpenApiSmokeOptions {
  env?: FeishuSmokeEnv;
  fetch?: OpenApiFetch;
  now?: () => Date;
}

export async function runFeishuOpenApiSmoke(options: FeishuOpenApiSmokeOptions = {}): Promise<SendCardResult> {
  const env = options.env ?? process.env;
  const missing = requiredEnvKeys.filter((key) => !env[key]);
  const targetId = env.FEISHU_TEST_CHAT_ID ?? "";
  if (missing.length > 0) {
    return {
      status: "failed",
      target_id: targetId,
      error: {
        code: "CONFIGURATION_INVALID",
        message: `Missing required Feishu smoke environment variables: ${missing.join(", ")}`,
        retryable: false,
        severity: "error",
        details: {
          missing_keys: missing
        }
      }
    };
  }

  const connector = new OpenApiFeishuConnector({
    appId: env.FEISHU_APP_ID ?? "",
    appSecret: env.FEISHU_APP_SECRET ?? "",
    fetch: options.fetch,
    now: options.now
  });

  return connector.sendCard({
    mode: "openapi_bot",
    target_type: "chat",
    target_id: targetId,
    card_type: "environment_scan_report",
    title: "FDE Feishu Connector Smoke",
    summary: "OpenAPI bot card delivery check.",
    severity: "low",
    data: {
      smoke: true,
      connector: "feishu-openapi"
    },
    correlation_id: "corr-feishu-smoke",
    trace_id: "trace-feishu-smoke",
    run_id: "run-feishu-smoke"
  });
}

const requiredEnvKeys = [
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_TEST_CHAT_ID"
] as const;
