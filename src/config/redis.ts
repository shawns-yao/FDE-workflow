import type { RedisOptions } from "ioredis";

export interface RedisRuntimeConfig {
  host: string;
  port: number;
  db: number;
  password?: string;
  keyPrefix: string;
  streamName: string;
  dlqStreamName: string;
  blockMs: number;
  batchSize: number;
  pendingIdleMs: number;
}

export type RedisConfigEnv = Partial<Record<string, string>>;

export function loadRedisConfig(env: RedisConfigEnv = process.env): RedisRuntimeConfig {
  const redisUrl = readOptionalString(env.REDIS_URL);
  const parsedUrl = redisUrl ? new URL(redisUrl) : undefined;

  return {
    host: readOptionalString(env.REDIS_HOST) ?? parsedUrl?.hostname ?? "127.0.0.1",
    port: readNumber(readOptionalString(env.REDIS_PORT), parsedUrl?.port ? Number(parsedUrl.port) : 6379),
    db: readNumber(readOptionalString(env.REDIS_DB), parsedUrl?.pathname ? Number(parsedUrl.pathname.slice(1) || 0) : 0),
    password: readOptionalString(env.REDIS_PASSWORD) ?? (parsedUrl?.password ? decodeURIComponent(parsedUrl.password) : undefined),
    keyPrefix: readOptionalString(env.REDIS_KEY_PREFIX) ?? "fde:",
    streamName: readOptionalString(env.FDE_EVENT_STREAM) ?? "fde.events",
    dlqStreamName: readOptionalString(env.FDE_EVENT_DLQ_STREAM) ?? "fde.events.dlq",
    blockMs: readNumber(env.FDE_REDIS_BLOCK_MS, 5000),
    batchSize: readNumber(env.FDE_REDIS_BATCH_SIZE, 10),
    pendingIdleMs: readNumber(env.FDE_REDIS_PENDING_IDLE_MS, 30000)
  };
}

export function toRedisOptions(config: RedisRuntimeConfig): RedisOptions {
  return {
    host: config.host,
    port: config.port,
    db: config.db,
    password: config.password,
    keyPrefix: config.keyPrefix,
    lazyConnect: true,
    maxRetriesPerRequest: 3
  };
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function readOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
