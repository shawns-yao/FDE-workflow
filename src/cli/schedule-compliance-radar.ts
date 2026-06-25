import { ComplianceRadarScheduler } from "../radars/compliance/scheduler.js";
import { createScheduledScanRequest, loadComplianceRadarScheduleConfig } from "../radars/compliance/schedule-config.js";
import { createComplianceRadarRuntime } from "../radars/compliance/service-factory.js";

const config = loadComplianceRadarScheduleConfig();
const runtime = createComplianceRadarRuntime({ artifactRoot: config.artifact_root });

const scheduler = new ComplianceRadarScheduler({
  service: runtime.service,
  request: () => createScheduledScanRequest(config.request.environment, config.request.mode, config.request.targets),
  interval_ms: config.interval_ms
});

scheduler.start();
console.log(
  JSON.stringify(
    {
      status: "scheduled",
      interval_ms: config.interval_ms,
      environment: config.request.environment,
      mode: config.request.mode,
      targets: config.request.targets,
      artifact_root: config.artifact_root
    },
    null,
    2
  )
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    scheduler.stop();
    await runtime.close();
    process.exit(0);
  });
}
