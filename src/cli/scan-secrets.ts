import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isSensitiveKey } from "../common/redact.js";

const [root = "fixtures"] = process.argv.slice(2);
const findings: string[] = [];

await scan(root);

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(finding);
  }
  process.exit(1);
}

console.log(`no fixture secret keys found: ${root}`);

async function scan(path: string): Promise<void> {
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const entry of await readdir(path)) {
      await scan(join(path, entry));
    }
    return;
  }

  if (!path.endsWith(".json")) {
    return;
  }

  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  inspect(parsed, path, "$");
}

function inspect(value: unknown, file: string, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspect(item, file, `${path}[${index}]`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key) && child !== "[REDACTED]") {
      findings.push(`${file}:${path}.${key} contains sensitive key`);
    }
    inspect(child, file, `${path}.${key}`);
  }
}
