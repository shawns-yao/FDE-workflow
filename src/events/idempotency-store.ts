import type { Redis as RedisClient } from "ioredis";

export type IdempotencyState = "processed" | "processing" | "failed";

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyState | undefined>;
  set(key: string, state: IdempotencyState, ttlSeconds?: number): Promise<void>;
  has(key: string): Promise<boolean>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly values = new Map<string, { state: IdempotencyState; expiresAt?: number }>();

  async get(key: string): Promise<IdempotencyState | undefined> {
    const record = this.values.get(key);
    if (!record) {
      return undefined;
    }
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return record.state;
  }

  async set(key: string, state: IdempotencyState, ttlSeconds?: number): Promise<void> {
    this.values.set(key, {
      state,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined
    });
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }
}

export function ingressKey(source: string, upstreamId: string): string {
  return `ingress:${source}:${upstreamId}`;
}

export function consumerKey(consumerId: string, eventId: string): string {
  return `consumer:${consumerId}:${eventId}`;
}

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private readonly redis: RedisClient) {}

  async get(key: string): Promise<IdempotencyState | undefined> {
    const value = await this.redis.get(key);
    if (value === "processed" || value === "processing" || value === "failed") {
      return value;
    }
    return undefined;
  }

  async set(key: string, state: IdempotencyState, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redis.set(key, state, "EX", ttlSeconds);
      return;
    }
    await this.redis.set(key, state);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }
}
