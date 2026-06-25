import { randomBytes } from "node:crypto";

export type IdPrefix =
  | "evt"
  | "corr"
  | "trace"
  | "run"
  | "task"
  | "scan"
  | "artifact"
  | "diagnosis"
  | "notification"
  | "consumer"
  | "delivery";

/**
 * 生成时间有序 ID（类 UUID v7 结构）
 *
 * 结构: {prefix}-{timestamp_ms_base36}-{random_hex}
 *
 * 特性：
 * - 按时间排序（毫秒精度）
 * - 全局唯一（随机部分 128 位熵）
 * - 可读性好（base36 编码）
 *
 * 示例: evt-m3x5k9r2-a1b2c3d4e5f6g7h8
 */
export function createId(prefix: IdPrefix): string {
  const timestampMs = Date.now();
  const timestampBase36 = timestampMs.toString(36).padStart(9, "0");
  const randomPart = randomBytes(16).toString("hex");
  return `${prefix}-${timestampBase36}-${randomPart}`;
}

/**
 * 从 ID 中提取创建时间戳
 *
 * @param id - createId 生成的 ID
 * @returns Date 对象，如果 ID 格式无效则返回 undefined
 */
export function extractTimestampFromId(id: string): Date | undefined {
  const parts = id.split("-");
  if (parts.length < 3) return undefined;

  const timestampPart = parts[1];
  try {
    const timestampMs = parseInt(timestampPart, 36);
    if (Number.isNaN(timestampMs) || timestampMs <= 0) return undefined;
    return new Date(timestampMs);
  } catch {
    return undefined;
  }
}