import type { ErrorCode } from "../../common/contracts.js";
import type { ComplianceProbe } from "./probe.js";
import type { EnvironmentScanRequest, RadarTarget, RadarTargetResult } from "./types.js";

export interface HttpProbeResponse {
  ok: boolean;
  status: number;
}

export interface HttpProbeRequest {
  method: "GET";
  headers: Record<string, string>;
}

export type HttpProbeFetch = (url: string, init: HttpProbeRequest) => Promise<HttpProbeResponse>;

export interface HttpProbeOptions {
  baseUrl?: string;
  token?: string;
  fetch?: HttpProbeFetch;
}

export function createGitLabProbe(options: HttpProbeOptions): ComplianceProbe {
  return createHttpProbe({
    target: "gitlab",
    name: "gitlab-api-version",
    url: `${trimEnd(options.baseUrl)}/api/v4/version`,
    token: options.token,
    tokenHeader: "PRIVATE-TOKEN",
    fetch: options.fetch
  });
}

export function createTektonProbe(options: HttpProbeOptions): ComplianceProbe {
  return createHttpProbe({
    target: "tekton",
    name: "tekton-api",
    url: `${trimEnd(options.baseUrl)}/apis/tekton.dev/v1/pipelineruns`,
    token: options.token,
    tokenHeader: "Authorization",
    tokenPrefix: "Bearer ",
    fetch: options.fetch
  });
}

export function createArgoCdProbe(options: HttpProbeOptions): ComplianceProbe {
  return createHttpProbe({
    target: "argocd",
    name: "argocd-api-version",
    url: `${trimEnd(options.baseUrl)}/api/version`,
    token: options.token,
    tokenHeader: "Authorization",
    tokenPrefix: "Bearer ",
    fetch: options.fetch
  });
}

export function createKubernetesProbe(options: HttpProbeOptions): ComplianceProbe {
  return createHttpProbe({
    target: "kubernetes",
    name: "kubernetes-readyz",
    url: `${trimEnd(options.baseUrl)}/readyz`,
    token: options.token,
    tokenHeader: "Authorization",
    tokenPrefix: "Bearer ",
    fetch: options.fetch
  });
}

interface CreateHttpProbeInput {
  target: RadarTarget;
  name: string;
  url: string;
  token?: string;
  tokenHeader: string;
  tokenPrefix?: string;
  fetch?: HttpProbeFetch;
}

function createHttpProbe(input: CreateHttpProbeInput): ComplianceProbe {
  return {
    target: input.target,
    async run(_request: EnvironmentScanRequest): Promise<RadarTargetResult> {
      if (!input.url || input.url.startsWith("/")) {
        return critical(input.target, input.name, "AUTHENTICATION_FAILED", "缺少探测 endpoint");
      }
      if (!input.token) {
        return critical(input.target, input.name, "AUTHENTICATION_FAILED", "缺少探测凭据");
      }

      const startedAt = Date.now();
      try {
        const response = await (input.fetch ?? defaultFetch)(input.url, {
          method: "GET",
          headers: {
            [input.tokenHeader]: `${input.tokenPrefix ?? ""}${input.token}`
          }
        });
        const latencyMs = Date.now() - startedAt;
        if (response.ok) {
          return {
            name: input.target,
            status: "healthy",
            checks: [
              {
                name: input.name,
                layer: "connectivity",
                status: "healthy",
                message: "API reachable",
                latency_ms: latencyMs
              }
            ]
          };
        }
        return critical(input.target, input.name, response.status === 401 || response.status === 403 ? "PERMISSION_DENIED" : "UPSTREAM_UNAVAILABLE", `API returned ${response.status}`, latencyMs);
      } catch (error) {
        return critical(input.target, input.name, "UPSTREAM_UNAVAILABLE", error instanceof Error ? error.message : "API request failed");
      }
    }
  };
}

async function defaultFetch(url: string, init: HttpProbeRequest): Promise<HttpProbeResponse> {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status
  };
}

function critical(target: RadarTarget, name: string, code: ErrorCode, message: string, latencyMs?: number): RadarTargetResult {
  return {
    name: target,
    status: "critical",
    checks: [
      {
        name,
        layer: "connectivity",
        status: "critical",
        message,
        latency_ms: latencyMs,
        error: {
          code,
          message,
          retryable: code === "UPSTREAM_UNAVAILABLE",
          severity: "critical",
          details: {
            target
          }
        }
      }
    ]
  };
}

function trimEnd(value: string | undefined): string {
  return value?.replace(/\/+$/, "") ?? "";
}
