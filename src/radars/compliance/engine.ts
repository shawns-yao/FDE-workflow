import type { ArtifactRef } from "../../common/contracts.js";
import type { ComplianceProbe } from "./probe.js";
import { calculateOverallStatus } from "./status.js";
import type { EnvironmentScanRequest, EnvironmentScanResult, RadarTarget } from "./types.js";

export interface ComplianceRadarEngineOptions {
  reportBaseUri?: string;
}

export class ComplianceRadarEngine {
  private readonly probes: Map<RadarTarget, ComplianceProbe>;
  private readonly reportBaseUri: string;

  constructor(probes: ComplianceProbe[], options: ComplianceRadarEngineOptions = {}) {
    this.probes = new Map(probes.map((probe) => [probe.target, probe]));
    this.reportBaseUri = options.reportBaseUri ?? "artifacts/compliance";
  }

  async scan(request: EnvironmentScanRequest): Promise<EnvironmentScanResult> {
    const startedAt = new Date().toISOString();
    const targets = [];
    const pendingChecks: string[] = [];

    for (const target of request.targets) {
      const probe = this.probes.get(target);
      if (!probe) {
        pendingChecks.push(`${target}:probe_missing`);
        continue;
      }
      targets.push(await probe.run(request));
    }

    const finishedAt = new Date().toISOString();
    const overallStatus = calculateOverallStatus(targets);
    const reportArtifact = createReportArtifact(request.scan_id, this.reportBaseUri, finishedAt);

    return {
      scan_id: request.scan_id,
      environment: request.environment,
      trigger: request.trigger,
      mode: request.mode,
      overall_status: overallStatus,
      started_at: startedAt,
      finished_at: finishedAt,
      targets,
      artifact_refs: [reportArtifact],
      metadata: {
        pending_checks: pendingChecks
      }
    };
  }
}

function createReportArtifact(scanId: string, reportBaseUri: string, createdAt: string): ArtifactRef {
  return {
    artifact_uri: `${reportBaseUri}/${scanId}/environment-check-report.json`,
    artifact_type: "environment_check_report",
    content_type: "application/json",
    created_at: createdAt
  };
}
