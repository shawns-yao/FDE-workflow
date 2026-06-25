import type { ArgoSyncResult, BuildCompletedPayload, PipelineAgentConfig } from "./types.js";

export interface ArgoCdSyncController {
  sync(input: ArgoCdSyncInput): Promise<ArgoSyncResult>;
}

export interface ArgoCdSyncInput {
  build: BuildCompletedPayload;
}

export interface ArgoCdSyncHttpRequest {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface ArgoCdSyncHttpResponse {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
}

export type ArgoCdSyncFetch = (url: string, init: ArgoCdSyncHttpRequest) => Promise<ArgoCdSyncHttpResponse>;

export class HttpArgoCdSyncController implements ArgoCdSyncController {
  constructor(
    private readonly config: PipelineAgentConfig,
    private readonly fetchImpl: ArgoCdSyncFetch = defaultFetch
  ) {}

  async sync(input: ArgoCdSyncInput): Promise<ArgoSyncResult> {
    const appName = `${input.build.application}-${input.build.environment}`;
    if (!this.config.argocd_api_url || !this.config.argocd_token) {
      return {
        sync_status: "skipped",
        argocd_application: appName,
        error: {
          code: "CONFIGURATION_INVALID",
          message: "ArgoCD sync is enabled but API URL or token is not configured.",
          retryable: false,
          severity: "warning",
          details: {
            argocd_application: appName
          }
        }
      };
    }

    const url = `${this.config.argocd_api_url.replace(/\/+$/, "")}/api/v1/applications/${encodeURIComponent(appName)}/sync`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.argocd_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        revision: input.build.commit_sha,
        prune: false,
        dryRun: false
      })
    });

    if (!response.ok) {
      return {
        sync_status: "failed",
        argocd_application: appName,
        error: {
          code: response.status === 401 || response.status === 403 ? "PERMISSION_DENIED" : "UPSTREAM_UNAVAILABLE",
          message: `ArgoCD sync request failed with status ${response.status}`,
          retryable: response.status !== 401 && response.status !== 403,
          severity: "error",
          details: {
            argocd_application: appName,
            status: response.status
          }
        }
      };
    }

    return {
      sync_status: "triggered",
      argocd_application: appName,
      operation_id: `${input.build.build_id}:argocd-sync`
    };
  }
}

export class NoopArgoCdSyncController implements ArgoCdSyncController {
  async sync(input: ArgoCdSyncInput): Promise<ArgoSyncResult> {
    return {
      sync_status: "skipped",
      argocd_application: `${input.build.application}-${input.build.environment}`
    };
  }
}

async function defaultFetch(url: string, init: ArgoCdSyncHttpRequest): Promise<ArgoCdSyncHttpResponse> {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    json: async () => response.json()
  };
}
