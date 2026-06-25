import type { ArtifactStore } from "../../common/artifact-store.js";
import type { ErrorObject } from "../../common/contracts.js";
import type { EventPublisherService } from "../../events/event-publisher.js";
import { ComplianceRadarEngine } from "./engine.js";
import { toComplianceExecutionErrorEvent, toComplianceScanEvent } from "./events.js";
import type { RadarHistoryRepository } from "./history.js";
import { ComplianceReportWriter } from "./report-writer.js";
import type { EnvironmentScanRequest, EnvironmentScanResult } from "./types.js";

export class ComplianceRadarService {
  constructor(
    private readonly engine: ComplianceRadarEngine,
    private readonly historyRepository: RadarHistoryRepository,
    private readonly eventPublisher: EventPublisherService,
    artifactStore?: ArtifactStore
  ) {
    this.reportWriter = artifactStore ? new ComplianceReportWriter(artifactStore) : undefined;
  }

  private readonly reportWriter?: ComplianceReportWriter;

  async scan(request: EnvironmentScanRequest): Promise<EnvironmentScanResult> {
    let result: EnvironmentScanResult | undefined;
    try {
      result = await this.engine.scan(request);
      const resultWithReports = await this.writeReports(result);
      await this.historyRepository.save(resultWithReports);
      const publishResult = await this.eventPublisher.publish(toComplianceScanEvent(request, resultWithReports));
      if (!publishResult.published) {
        throw new ComplianceRadarExecutionError(publishResult.errors[0] ?? {
          code: "EVENT_PUBLISH_FAILED",
          message: "Compliance scan event was not published.",
          retryable: true,
          severity: "error",
          details: {
            scan_id: request.scan_id
          }
        });
      }
      return resultWithReports;
    } catch (error) {
      const errorObject = normalizeExecutionError(error);
      await this.publishExecutionError(request, errorObject, result);
      throw error instanceof ComplianceRadarExecutionError ? error : new ComplianceRadarExecutionError(errorObject);
    }
  }

  private async writeReports(result: EnvironmentScanResult): Promise<EnvironmentScanResult> {
    if (!this.reportWriter) {
      return result;
    }
    let artifactRefs;
    try {
      artifactRefs = await this.reportWriter.write(result);
    } catch (error) {
      throw new ComplianceRadarExecutionError({
        code: "ARTIFACT_WRITE_FAILED",
        message: error instanceof Error ? error.message : "Compliance report artifact write failed.",
        retryable: true,
        severity: "error",
        details: {
          scan_id: result.scan_id
        }
      });
    }
    return {
      ...result,
      artifact_refs: artifactRefs
    };
  }

  private async publishExecutionError(
    request: EnvironmentScanRequest,
    error: ErrorObject,
    result?: EnvironmentScanResult
  ): Promise<void> {
    try {
      await this.eventPublisher.publish(toComplianceExecutionErrorEvent(request, error, result));
    } catch {
      // Keep the original execution failure visible to the caller.
    }
  }
}

export class ComplianceRadarExecutionError extends Error {
  constructor(readonly error: ErrorObject) {
    super(error.message);
    this.name = "ComplianceRadarExecutionError";
  }
}

function normalizeExecutionError(error: unknown): ErrorObject {
  if (error instanceof ComplianceRadarExecutionError) {
    return error.error;
  }
  if (isErrorObject(error)) {
    return error;
  }
  return {
    code: "UPSTREAM_UNAVAILABLE",
    message: error instanceof Error ? error.message : "Compliance radar execution failed.",
    retryable: true,
    severity: "error",
    details: {}
  };
}

function isErrorObject(value: unknown): value is ErrorObject {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.code === "string" &&
    typeof record.message === "string" &&
    typeof record.retryable === "boolean" &&
    typeof record.severity === "string";
}
