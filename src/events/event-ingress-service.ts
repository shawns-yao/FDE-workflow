import type { Environment, ErrorObject } from "../common/contracts.js";
import type { CloudEvent } from "./cloudevent.js";
import type { EventPublishResult, EventPublisherService } from "./event-publisher.js";
import type { HeaderMap, IngressAuthResult } from "./ingress-auth.js";
import { verifyArgoCdWebhookToken, verifyGitLabWebhookToken, verifyTektonReportToken } from "./ingress-auth.js";
import {
  normalizeArgoCdApplicationDegraded,
  normalizeGitLabMergeRequestUpdated,
  normalizeKubernetesPodFailed,
  normalizeTektonPipelineRunCompleted
} from "./normalizer.js";

export type IngressSource = "gitlab" | "tekton" | "argocd" | "kubernetes" | "feishu" | string;

export interface EventIngressCredentials {
  gitlabToken?: string;
  tektonReportToken?: string;
  argocdToken?: string;
}

export interface EventIngressInput<TBody extends Record<string, unknown> = Record<string, unknown>> {
  source: IngressSource;
  headers: HeaderMap;
  environment: Environment;
  body: TBody;
}

export interface EventIngressResult<TData = Record<string, unknown>> {
  accepted: boolean;
  event?: CloudEvent<TData>;
  publish_result?: EventPublishResult;
  error?: ErrorObject;
}

export class EventIngressService {
  constructor(
    private readonly publisher: EventPublisherService,
    private readonly credentials: EventIngressCredentials
  ) {}

  async handle(input: EventIngressInput): Promise<EventIngressResult> {
    const auth = this.verify(input);
    if (!auth.ok) {
      return { accepted: false, error: auth.error };
    }

    const normalized = this.normalize(input);
    if (!normalized.event) {
      return { accepted: false, error: normalized.error };
    }

    const publishResult = await this.publisher.publish(normalized.event);
    return {
      accepted: publishResult.published,
      event: normalized.event,
      publish_result: publishResult,
      error: publishResult.published ? undefined : publishResult.errors[0]
    };
  }

  private verify(input: EventIngressInput): IngressAuthResult {
    if (input.source === "gitlab") {
      return verifyGitLabWebhookToken(input.headers, this.credentials.gitlabToken);
    }
    if (input.source === "tekton") {
      return verifyTektonReportToken(input.headers, this.credentials.tektonReportToken);
    }
    if (input.source === "argocd") {
      return verifyArgoCdWebhookToken(input.headers, this.credentials.argocdToken);
    }
    if (input.source === "kubernetes") {
      return { ok: true };
    }
    return { ok: true };
  }

  private normalize(input: EventIngressInput): EventIngressResult {
    if (input.source === "gitlab") {
      return { accepted: true, event: normalizeGitLabMergeRequestUpdated(input.body, input.environment) };
    }
    if (input.source === "tekton") {
      return { accepted: true, event: normalizeTektonPipelineRunCompleted(input.body, input.environment) };
    }
    if (input.source === "argocd") {
      return { accepted: true, event: normalizeArgoCdApplicationDegraded(input.body, input.environment) };
    }
    if (input.source === "kubernetes") {
      return { accepted: true, event: normalizeKubernetesPodFailed(input.body, input.environment) };
    }
    return {
      accepted: false,
      error: {
        code: "SCHEMA_VALIDATION_FAILED",
        message: `Unsupported ingress source: ${input.source}`,
        retryable: false,
        severity: "error",
        details: {
          source: input.source
        }
      }
    };
  }
}
