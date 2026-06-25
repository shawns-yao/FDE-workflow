import { createPipelineAgentWorker } from "../agents/pipeline/service-factory.js";
import { loadPipelineConfig, validatePipelineConfig } from "../agents/pipeline/config.js";

const config = loadPipelineConfig();
const validation = validatePipelineConfig(config);

if (!validation.valid) {
  console.error(
    JSON.stringify(
      {
        status: "invalid_config",
        errors: validation.errors
      },
      null,
      2
    )
  );
  process.exit(1);
}

const worker = createPipelineAgentWorker({ config });

await worker.start();

console.log(
  JSON.stringify(
    {
      status: "started",
      consumer_id: "pipeline-agent",
      queue_name: "agent.pipeline",
      subscribed_events: ["tekton.pipelinerun.completed"]
    },
    null,
    2
  )
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await worker.close();
    process.exit(0);
  });
}
