import type { EnvironmentScanHistoryRecord, EnvironmentScanResult, RadarTarget, RadarStatus } from "./types.js";

export interface RadarHistoryRepository {
  save(result: EnvironmentScanResult): Promise<EnvironmentScanHistoryRecord>;
  latest(environment: string): Promise<EnvironmentScanHistoryRecord | undefined>;
}

export class MemoryRadarHistoryRepository implements RadarHistoryRepository {
  private readonly records: EnvironmentScanHistoryRecord[] = [];

  async save(result: EnvironmentScanResult): Promise<EnvironmentScanHistoryRecord> {
    const record: EnvironmentScanHistoryRecord = {
      scan_id: result.scan_id,
      environment: result.environment,
      overall_status: result.overall_status,
      target_status: toTargetStatus(result),
      report_artifact_uri: result.artifact_refs[0]?.artifact_uri ?? "",
      created_at: result.finished_at
    };
    this.records.push(record);
    return record;
  }

  async latest(environment: string): Promise<EnvironmentScanHistoryRecord | undefined> {
    return [...this.records].reverse().find((record) => record.environment === environment);
  }
}

function toTargetStatus(result: EnvironmentScanResult): Record<RadarTarget, RadarStatus> {
  const status: Record<RadarTarget, RadarStatus> = {
    gitlab: "healthy",
    tekton: "healthy",
    argocd: "healthy",
    kubernetes: "healthy"
  };

  for (const target of result.targets) {
    status[target.name] = target.status;
  }

  return status;
}
