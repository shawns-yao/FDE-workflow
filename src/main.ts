import { loadLocalEnv } from "./common/load-env.js";
import { createFdeServiceRuntime } from "./app/service-runtime.js";
import { FdeRuntimeConfigError } from "./config/env.js";
import type { ErrorObject } from "./common/contracts.js";

loadLocalEnv();

const runtime = createRuntimeOrExit();
const host = runtime.config.http.host;
const port = runtime.config.http.port;

runtime.server.listen(port, host, () => {
  console.log(JSON.stringify({
    status: "started",
    service: "fde-workstation",
    host,
    port,
    environment: runtime.environment,
    event_backend: runtime.event_backend,
    endpoints: [
      "GET /health",
      "POST /webhook/gitlab",
      "POST /webhook/tekton",
      "POST /webhook/argocd",
      "POST /webhook/kubernetes",
      "POST /webhook/feishu/callback"
    ]
  }, null, 2));

  const startupMessage = process.env.FDE_FEISHU_STARTUP_MESSAGE;
  if (startupMessage) {
    void runtime.sendFeishuTextMessage(startupMessage).then((result) => {
      console.log(JSON.stringify({
        status: "feishu_startup_message_result",
        result
      }, null, 2));
    });
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await runtime.close();
    process.exit(0);
  });
}

function createRuntimeOrExit(): ReturnType<typeof createFdeServiceRuntime> {
  try {
    return createFdeServiceRuntime();
  } catch (error) {
    console.error(JSON.stringify({
      status: "startup_failed",
      error: toStartupError(error)
    }, null, 2));
    process.exit(1);
  }
}

function toStartupError(error: unknown): ErrorObject {
  if (error instanceof FdeRuntimeConfigError) {
    return error.error;
  }
  return {
    code: "CONFIGURATION_INVALID",
    message: error instanceof Error ? error.message : "FDE Workstation startup failed.",
    retryable: false,
    severity: "error",
    details: {
      stage: "startup"
    }
  };
}
