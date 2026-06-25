import { loadRedisConfig } from "../config/redis.js";

const config = loadRedisConfig();
console.log(
  JSON.stringify(
    {
      host: config.host,
      port: config.port,
      db: config.db,
      keyPrefix: config.keyPrefix,
      streamName: config.streamName,
      dlqStreamName: config.dlqStreamName,
      blockMs: config.blockMs,
      batchSize: config.batchSize,
      pendingIdleMs: config.pendingIdleMs,
      hasPassword: Boolean(config.password)
    },
    null,
    2
  )
);
