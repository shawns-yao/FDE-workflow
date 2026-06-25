import type { CloudEvent } from "../../events/cloudevent.js";
import type { ErrorObject } from "../../common/contracts.js";
import type { ComplianceEnvironmentScanEventData, EnvironmentScanRequest, EnvironmentScanResult, RadarTarget } from "./types.js";
import { countByStatus } from "./status.js";

export function toComplianceScanEvent(request: EnvironmentScanRequest, result: EnvironmentScanResult): CloudEvent<ComplianceEnvironmentScanEventData> {
  const criticalCount = countByStatus(result.targets, "critical");
  const warningCount = countByStatus(result.targets, "warning");
  const affectedTargets = result.targets.filter((target) => target.status !== "healthy").map((target) => target.name);
  const resultKind = result.overall_status === "healthy" ? "healthy" : "environment_unhealthy";
  const eventType = resultKind === "healthy" ? "compliance.environment.scan.completed" : "compliance.environment.scan.failed";

  return {
    specversion: "1.0",
    id: `evt-${request.scan_id}`,
    source: "compliance",
    type: eventType,
    subject: `environment/${request.environment}`,
    time: result.finished_at,
    datacontenttype: "application/json",
    correlation_id: request.correlation_id,
    trace_id: request.trace_id,
    run_id: request.run_id,
    application: "platform",
    environment: request.environment,
    data: {
      scan_id: result.scan_id,
      environment: result.environment,
      result_kind: resultKind,
      overall_status: result.overall_status,
      affected_targets: affectedTargets as RadarTarget[],
      critical_count: criticalCount,
      warning_count: warningCount,
      report_artifact_uri: result.artifact_refs[0]?.artifact_uri ?? ""
    },
    metadata: {
      pending_checks: result.metadata.pending_checks
    }
  };
}

export function toComplianceExecutionErrorEvent(
  request: EnvironmentScanRequest,
  error: ErrorObject,
  result?: EnvironmentScanResult
): CloudEvent<ComplianceEnvironmentScanEventData> {
  return {
    specversion: "1.0",
    id: `evt-${request.scan_id}:execution-error`,
    source: "compliance",
    type: "compliance.environment.scan.failed",
    subject: `environment/${request.environment}`,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    correlation_id: request.correlation_id,
    trace_id: request.trace_id,
    run_id: request.run_id,
    application: "platform",
    environment: request.environment,
    data: {
      scan_id: request.scan_id,
      environment: request.environment,
      result_kind: "execution_error",
      overall_status: "critical",
      affected_targets: result?.targets.map((target) => target.name) ?? request.targets,
      critical_count: result ? countByStatus(result.targets, "critical") : 0,
      warning_count: result ? countByStatus(result.targets, "warning") : 0,
      report_artifact_uri: result?.artifact_refs[0]?.artifact_uri ?? "",
      error
    },
    metadata: {
      pending_checks: result?.metadata.pending_checks ?? []
    }
  };
}
