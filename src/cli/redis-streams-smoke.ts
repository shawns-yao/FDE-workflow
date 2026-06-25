import { runRedisStreamsSmoke } from "../events/redis-streams-smoke.js";

const result = await runRedisStreamsSmoke();
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
