import type { IMConnectorService } from "./connector.js";
import { OpenApiFeishuConnector, type OpenApiFetch } from "./openapi-feishu-connector.js";
import { WebhookFeishuConnector, type WebhookFetch } from "./webhook-feishu-connector.js";

export type FeishuConnectorEnv = Partial<Record<string, string>>;

export interface FeishuConnectorFactoryOptions {
  env?: FeishuConnectorEnv;
  webhookFetch?: WebhookFetch;
  openApiFetch?: OpenApiFetch;
}

export function createFeishuConnectorFromEnv(env: FeishuConnectorEnv = process.env, options: Omit<FeishuConnectorFactoryOptions, "env"> = {}): IMConnectorService {
  if (env.FEISHU_MODE === "openapi_bot") {
    return new OpenApiFeishuConnector({
      appId: env.FEISHU_APP_ID ?? "",
      appSecret: env.FEISHU_APP_SECRET ?? "",
      fetch: options.openApiFetch
    });
  }

  return new WebhookFeishuConnector({
    webhookUrl: env.FEISHU_WEBHOOK_URL ?? "",
    webhookSecret: env.FEISHU_WEBHOOK_SECRET,
    fetch: options.webhookFetch
  });
}
