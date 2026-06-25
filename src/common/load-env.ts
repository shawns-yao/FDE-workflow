import { existsSync, readFileSync } from "node:fs";

export interface LoadLocalEnvOptions {
  path?: string;
  env?: NodeJS.ProcessEnv;
}

export function loadLocalEnv(options: LoadLocalEnvOptions = {}): void {
  const path = options.path ?? ".env";
  const env = options.env ?? process.env;
  if (!existsSync(path)) {
    return;
  }

  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const parsed = parseEnvLine(line);
    if (!parsed || env[parsed.key] !== undefined) {
      continue;
    }
    env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed;
  const separatorIndex = normalized.indexOf("=");
  if (separatorIndex <= 0) {
    return undefined;
  }

  const key = normalized.slice(0, separatorIndex).trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(key)) {
    return undefined;
  }

  return {
    key,
    value: unquoteEnvValue(normalized.slice(separatorIndex + 1).trim())
  };
}

function unquoteEnvValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/gu, "\n").replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}
