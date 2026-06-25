import type { ComplianceProbe } from "./probe.js";
import { createArgoCdProbe, createGitLabProbe, createKubernetesProbe, createTektonProbe, type HttpProbeFetch } from "./http-probes.js";

export type ComplianceProbeEnv = Partial<Record<string, string>>;

export interface ComplianceProbeFactoryOptions {
  env?: ComplianceProbeEnv;
  fetch?: HttpProbeFetch;
}

export function createComplianceProbesFromEnv(env: ComplianceProbeEnv = process.env, fetch?: HttpProbeFetch): ComplianceProbe[] {
  return [
    createGitLabProbe({
      baseUrl: env.GITLAB_BASE_URL,
      token: env.GITLAB_TOKEN,
      fetch
    }),
    createTektonProbe({
      baseUrl: env.TEKTON_API_BASE_URL,
      token: env.TEKTON_TOKEN,
      fetch
    }),
    createArgoCdProbe({
      baseUrl: env.ARGOCD_BASE_URL,
      token: env.ARGOCD_TOKEN,
      fetch
    }),
    createKubernetesProbe({
      baseUrl: env.KUBERNETES_API_BASE_URL ?? env.K8S_API_BASE_URL,
      token: env.KUBERNETES_TOKEN ?? env.K8S_TOKEN,
      fetch
    })
  ];
}
