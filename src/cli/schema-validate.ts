import { readFile } from "node:fs/promises";
import { dirname, relative, normalize } from "node:path";
import { FileSchemaRegistry } from "../common/schema-registry.js";

const [fixturePath, schemaPath] = process.argv.slice(2);

if (!fixturePath || !schemaPath) {
  console.error("Usage: npm run schema:validate -- <fixture.json> <schema.json>");
  process.exit(2);
}

const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
const { rootDir, schemaRef } = resolveSchemaRoot(schemaPath);
const registry = new FileSchemaRegistry(rootDir);
const { errors } = await registry.validate(schemaRef, fixture);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log(`valid: ${fixturePath}`);

function resolveSchemaRoot(path: string): { rootDir: string; schemaRef: string } {
  const normalized = normalize(path);
  const parts = normalized.split(/[\\/]/);
  const schemaIndex = parts.lastIndexOf("schemas");
  if (schemaIndex >= 0) {
    const rootDir = parts.slice(0, schemaIndex + 1).join("/") || "schemas";
    const schemaRef = parts.slice(schemaIndex + 1).join("/");
    return { rootDir, schemaRef };
  }
  return {
    rootDir: dirname(path),
    schemaRef: relative(dirname(path), path)
  };
}
