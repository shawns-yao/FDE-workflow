import { redactSensitiveFields } from "../common/redact.js";
import { createId } from "../common/ids.js";
import type { Environment } from "../common/contracts.js";
import type { CloudEvent } from "./cloudevent.js";
import type { EventSource, EventType } from "./event-types.js";

export interface NormalizeEventInput<TData = Record<string, unknown>> {
  source: EventSource;
  type: EventType;
  subject: string;
  data: TData;
  application: string;
  environment: Environment;
  upstream_id?: string;
  correlation_id?: string;
  trace_id?: string;
  run_id?: string;
  occurred_at?: string;
  adapter_version: string;
}

export function normalizeEvent<TData extends Record<string, unknown>>(input: NormalizeEventInput<TData>): CloudEvent<TData> {
  return {
    specversion: "1.0",
    id: createId("evt"),
    source: input.source,
    type: input.type,
    subject: input.subject,
    time: input.occurred_at ?? new Date().toISOString(),
    datacontenttype: "application/json",
    correlation_id: input.correlation_id ?? createId("corr"),
    trace_id: input.trace_id ?? createId("trace"),
    run_id: input.run_id ?? createId("run"),
    application: input.application,
    environment: input.environment,
    data: redactSensitiveFields(input.data),
    metadata: {
      upstream_id: input.upstream_id,
      upstream_system: input.source,
      adapter_version: input.adapter_version
    }
  };
}

export function normalizeGitLabMergeRequestUpdated(data: Record<string, unknown>, environment: Environment): CloudEvent<Record<string, unknown>> {
  const projectId = String(data["project_id"] ?? "unknown");
  const mrIid = String(data["merge_request_iid"] ?? data["iid"] ?? "unknown");
  return normalizeEvent({
    source: "gitlab",
    type: "gitlab.mr.updated",
    subject: `project/${projectId}/mr/${mrIid}`,
    data,
    application: String(data["application"] ?? data["project_name"] ?? "unknown"),
    environment,
    upstream_id: `gitlab-project-${projectId}-mr-${mrIid}`,
    adapter_version: "gitlab-webhook-v1"
  });
}

export function normalizeTektonPipelineRunCompleted(data: Record<string, unknown>, environment: Environment): CloudEvent<Record<string, unknown>> {
  const namespace = String(data["namespace"] ?? "default");
  const pipelineRunName = String(data["pipeline_run_name"] ?? "unknown");
  return normalizeEvent({
    source: "tekton",
    type: "tekton.pipelinerun.completed",
    subject: `namespace/${namespace}/pipelinerun/${pipelineRunName}`,
    data,
    application: String(data["application"] ?? "unknown"),
    environment,
    upstream_id: `tekton-${namespace}-${pipelineRunName}`,
    adapter_version: "tekton-report-v1"
  });
}

export function normalizeArgoCdApplicationDegraded(data: Record<string, unknown>, environment: Environment): CloudEvent<Record<string, unknown>> {
  const application = String(data["application"] ?? data["argocd_application"] ?? "unknown");
  return normalizeEvent({
    source: "argocd",
    type: "argocd.application.degraded",
    subject: `application/${application}`,
    data,
    application,
    environment,
    upstream_id: `argocd-${application}-degraded`,
    adapter_version: "argocd-webhook-v1"
  });
}

export function normalizeKubernetesPodFailed(data: Record<string, unknown>, environment: Environment): CloudEvent<Record<string, unknown>> {
  const namespace = String(data["namespace"] ?? "default");
  const podName = String(data["pod_name"] ?? data["name"] ?? "unknown");
  return normalizeEvent({
    source: "kubernetes",
    type: "kubernetes.pod.failed",
    subject: `namespace/${namespace}/pod/${podName}`,
    data,
    application: String(data["application"] ?? "unknown"),
    environment,
    upstream_id: `kubernetes-${namespace}-pod-${podName}-failed`,
    adapter_version: "kubernetes-event-v1"
  });
}
