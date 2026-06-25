import { createId } from "../common/ids.js";
import { createComplianceRadarRuntime } from "../radars/compliance/service-factory.js";
import type { EnvironmentScanRequest, RadarMode, RadarTarget } from "../radars/compliance/types.js";

const environment = readArg("--env") ?? "dev";
const mode = (readArg("--mode") ?? "fast") as RadarMode;
const targets = (readArg("--targets") ?? "gitlab,tekton,argocd,kubernetes").split(",").filter(Boolean) as RadarTarget[];
const scanId = readArg("--scan-id") ?? createId("scan");
const artifactRoot = readArg("--artifact-root") ?? ".";

const runtime = createComplianceRadarRuntime({ artifactRoot });

const request: EnvironmentScanRequest = {
  scan_id: scanId,
  trigger: "manual",
  environment: environment === "prod" || environment === "test" ? environment : "dev",
  mode,
  targets,
  required_layers: ["connectivity", "permission", "configuration"],
  correlation_id: createId("corr"),
  trace_id: createId("trace"),
  run_id: createId("run")
};

try {
  const result = await runtime.service.scan(request);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await runtime.close();
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}
