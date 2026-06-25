import { loadLocalEnv } from "../common/load-env.js";
import { runFeishuOpenApiSmoke } from "../connectors/feishu/send-smoke.js";

loadLocalEnv();

const result = await runFeishuOpenApiSmoke();

console.log(JSON.stringify(result, null, 2));

if (result.status !== "sent") {
  process.exitCode = 1;
}
