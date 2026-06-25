import { createId } from "../../common/ids.js";
import type { Environment } from "../../common/contracts.js";
import type { EnvironmentScanRequest, RadarMode, RadarTarget } from "./types.js";

export interface ComplianceRadarScheduleConfig {
  request: EnvironmentScanRequest;
  interval_ms: number;
  artifact_root: string;
}

export function loadComplianceRadarScheduleConfig(args: string[] = process.argv.slice(2)): ComplianceRadarScheduleConfig {
  const environment = parseEnvironment(readArg(args, "--env"));
  const mode = (readArg(args, "--mode") ?? "fast") as RadarMode;
  const targets = parseTargets(readArg(args, "--targets"));
  const intervalMs = parsePositiveInteger(readArg(args, "--interval-ms"), 300000);
  const artifactRoot = readArg(args, "--artifact-root") ?? ".";

  return {
    interval_ms: intervalMs,
    artifact_root: artifactRoot,
    request: createScheduledScanRequest(environment, mode, targets)
  };
}

export function createScheduledScanRequest(environment: Environment, mode: RadarMode, targets: RadarTarget[]): EnvironmentScanRequest {
  return {
    scan_id: createId("scan"),
    trigger: "scheduled",
    environment,
    mode,
    targets,
    required_layers: ["connectivity", "permission", "configuration"],
    correlation_id: createId("corr"),
    trace_id: createId("trace"),
    run_id: createId("run")
  };
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

function parseEnvironment(value: string | undefined): Environment {
  if (value === "test" || value === "prod") {
    return value;
  }
  return "dev";
}

function parseTargets(value: string | undefined): RadarTarget[] {
  if (!value) {
    return ["gitlab", "tekton", "argocd", "kubernetes"];
  }
  return value.split(",").filter(Boolean) as RadarTarget[];
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
