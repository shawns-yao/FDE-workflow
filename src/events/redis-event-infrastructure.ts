import { Redis, type Redis as RedisClient } from "ioredis";
import { loadRedisConfig, toRedisOptions, type RedisConfigEnv, type RedisRuntimeConfig } from "../config/redis.js";
import { RedisIdempotencyStore } from "./idempotency-store.js";
import { RedisStreamsEventBroker } from "./redis-streams-event-broker.js";

export interface RedisEventInfrastructure {
  redis: RedisClient;
  config: RedisRuntimeConfig;
  broker: RedisStreamsEventBroker;
  idempotencyStore: RedisIdempotencyStore;
  close(): Promise<void>;
}

export function createRedisEventInfrastructure(env?: RedisConfigEnv): RedisEventInfrastructure {
  const config = loadRedisConfig(env);
  const redis = new Redis(toRedisOptions(config));
  const broker = new RedisStreamsEventBroker(redis, {
    streamName: config.streamName,
    dlqStreamName: config.dlqStreamName,
    blockMs: config.blockMs,
    batchSize: config.batchSize,
    pendingIdleMs: config.pendingIdleMs
  });

  return {
    redis,
    config,
    broker,
    idempotencyStore: new RedisIdempotencyStore(redis),
    async close() {
      await broker.stop();
      redis.disconnect();
    }
  };
}
