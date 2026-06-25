import type { ArtifactRef, Environment, ErrorObject } from "../../common/contracts.js";

export type RadarTarget = "gitlab" | "tekton" | "argocd" | "kubernetes";
export type RadarTrigger = "scheduled" | "manual" | "preflight" | "event";
export type RadarMode = "full" | "fast" | "targeted";
export type RadarLayer = "connectivity" | "permission" | "configuration";
export type RadarStatus = "healthy" | "warning" | "critical";
export type ScanResultKind = "healthy" | "environment_unhealthy" | "execution_error";

export interface EnvironmentScanRequest {
  scan_id: string;
  trigger: RadarTrigger;
  environment: Environment;
  mode: RadarMode;
  targets: RadarTarget[];
  required_layers: RadarLayer[];
  correlation_id: string;
  trace_id: string;
  run_id: string;
}

export interface RadarCheckResult {
  name: string;
  layer: RadarLayer;
  status: RadarStatus;
  message: string;
  latency_ms?: number;
  impact?: string;
  recommendation?: string;
  error?: ErrorObject;
}

export interface RadarTargetResult {
  name: RadarTarget;
  status: RadarStatus;
  checks: RadarCheckResult[];
}

export interface EnvironmentScanResult {
  scan_id: string;
  environment: Environment;
  trigger: RadarTrigger;
  mode: RadarMode;
  overall_status: RadarStatus;
  started_at: string;
  finished_at: string;
  targets: RadarTargetResult[];
  artifact_refs: ArtifactRef[];
  metadata: {
    pending_checks: string[];
  };
}

export interface EnvironmentScanHistoryRecord {
  scan_id: string;
  environment: Environment;
  overall_status: RadarStatus;
  target_status: Record<RadarTarget, RadarStatus>;
  report_artifact_uri: string;
  created_at: string;
}

export interface ComplianceEnvironmentScanEventData {
  scan_id: string;
  environment: Environment;
  result_kind: ScanResultKind;
  overall_status: RadarStatus;
  affected_targets: RadarTarget[];
  critical_count: number;
  warning_count: number;
  report_artifact_uri: string;
  error?: ErrorObject;
}
