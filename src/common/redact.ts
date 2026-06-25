const sensitiveFragments = [
  "token",
  "secret",
  "password",
  "passwd",
  "authorization",
  "cookie",
  "private_key",
  "access_key",
  "refresh_token",
  "client_secret",
  "webhook_secret",
  "app_secret",
  "encrypt_key"
];

// 预编译正则表达式，避免每次调用都创建新实例
// 使用 \b 单词边界 + 组合下划线的匹配方式
const compiledPatterns: Array<{ fragment: string; pattern: RegExp }> = sensitiveFragments.map((fragment) => ({
  fragment,
  pattern: new RegExp(`(^|[_.\\-])${escapeRegExp(fragment)}([_.\\-]|$)`, "i")
}));

export function isSensitiveKey(key: string): boolean {
  return compiledPatterns.some(({ pattern }) => pattern.test(key));
}

export function redactSensitiveFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item)) as T;
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? "[REDACTED]" : redactSensitiveFields(child);
    }
    return result as T;
  }

  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}