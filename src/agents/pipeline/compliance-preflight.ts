import { createId } from "../../common/ids.js";
import type { ComplianceRadarService } from "../../radars/compliance/service.js";
import type { EnvironmentScanResult, RadarTarget } from "../../radars/compliance/types.js";
import type { BuildCompletedPayload, PipelinePreflightResult } from "./types.js";

export interface PipelinePreflightChecker {
  check(input: PipelinePreflightInput): Promise<PipelinePreflightResult>;
}

export interface PipelinePreflightInput {
  build: BuildCompletedPayload;
  correlation_id: string;
  trace_id: string;
  run_id: string;
}

export class ComplianceRadarPreflightChecker implements PipelinePreflightChecker {
  constructor(
    private readonly radarService: Pick<ComplianceRadarService, "scan">,
    private readonly targets: RadarTarget[] = ["gitlab", "tekton", "argocd", "kubernetes"]
  ) {}

  async check(input: PipelinePreflightInput): Promise<PipelinePreflightResult> {
    const scanResult = await this.radarService.scan({
      scan_id: createId("scan"),
      trigger: "preflight",
      environment: input.build.environment,
      mode: "fast",
      targets: this.targets,
      required_layers: ["connectivity", "permission", "configuration"],
      correlation_id: input.correlation_id,
      trace_id: input.trace_id,
      run_id: input.run_id
    });

    if (scanResult.overall_status === "critical") {
      return {
        status: "blocked",
        scan_result: scanResult,
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "Compliance preflight found critical dependency issues.",
          retryable: true,
          severity: "critical",
          details: {
            scan_id: scanResult.scan_id,
            report_artifact_uri: scanResult.artifact_refs[0]?.artifact_uri
          }
        }
      };
    }

    return {
      status: "passed",
      scan_result: scanResult
    };
  }
}

export class NoopPipelinePreflightChecker implements PipelinePreflightChecker {
  async check(): Promise<PipelinePreflightResult> {
    return {
      status: "skipped"
    };
  }
}
