import { readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";

export interface SchemaRegistry {
  getSchema(schemaRef: string): Promise<unknown>;
  validate(schemaRef: string, value: unknown): Promise<SchemaValidationResult>;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

type JsonSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  enum?: unknown[];
  items?: JsonSchema;
  const?: unknown;
  $ref?: string;
  anyOf?: JsonSchema[];
  pattern?: string;
  minLength?: number;
  minimum?: number;
};

export class FileSchemaRegistry implements SchemaRegistry {
  private readonly absoluteRootDir: string;

  constructor(rootDir = ".") {
    this.absoluteRootDir = resolve(rootDir);
  }

  async getSchema(schemaRef: string): Promise<unknown> {
    const schemaPath = resolve(this.absoluteRootDir, schemaRef);
    if (!schemaPath.startsWith(this.absoluteRootDir)) {
      throw new Error(`Schema path escapes root: ${schemaRef}`);
    }
    const content = await readFile(schemaPath, "utf8");
    return JSON.parse(content) as unknown;
  }

  async validate(schemaRef: string, value: unknown): Promise<SchemaValidationResult> {
    const schema = (await this.getSchema(schemaRef)) as JsonSchema;
    const normalizedRef = posix.normalize(schemaRef.replace(/\\/g, "/"));
    const errors = await this.validateNode(value, schema, "$", posix.dirname(normalizedRef));
    return {
      valid: errors.length === 0,
      errors
    };
  }

  private async validateNode(value: unknown, schema: JsonSchema, path: string, schemaDir: string): Promise<string[]> {
    if (schema.$ref) {
      const refPath = posix.normalize(posix.join(schemaDir, schema.$ref));
      const refSchema = (await this.getSchema(refPath)) as JsonSchema;
      return this.validateNode(value, refSchema, path, posix.dirname(refPath));
    }

    const errors: string[] = [];
    if (schema.anyOf) {
      const branchErrors = await Promise.all(
        schema.anyOf.map((candidate) => this.validateNode(value, candidate, path, schemaDir))
      );
      if (branchErrors.some((candidateErrors) => candidateErrors.length === 0)) {
        return errors;
      }
      errors.push(`${path}: value does not match anyOf`);
      return errors;
    }
    if (schema.const !== undefined && value !== schema.const) {
      errors.push(`${path}: expected const ${String(schema.const)}`);
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path}: value ${String(value)} is not in enum`);
    }
    if (schema.type && !matchesType(value, schema.type)) {
      errors.push(`${path}: expected type ${schema.type}`);
      return errors;
    }
    if (schema.type === "string" && typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: string length must be at least ${schema.minLength}`);
    }
    if (schema.type === "string" && typeof value === "string" && schema.pattern !== undefined) {
      const pattern = new RegExp(schema.pattern);
      if (!pattern.test(value)) {
        errors.push(`${path}: string does not match pattern ${schema.pattern}`);
      }
    }
    if ((schema.type === "number" || schema.type === "integer") && typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: number must be >= ${schema.minimum}`);
    }
    if (schema.type === "object" && schema.properties && isRecord(value)) {
      for (const requiredKey of schema.required ?? []) {
        if (!(requiredKey in value)) {
          errors.push(`${path}.${requiredKey}: required property missing`);
        }
      }
      const propertyKeys = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(value)) {
        if (!propertyKeys.has(key)) {
          if (schema.additionalProperties === false) {
            errors.push(`${path}.${key}: additional property is not allowed`);
          } else if (isRecord(schema.additionalProperties)) {
            errors.push(...(await this.validateNode(value[key], schema.additionalProperties, `${path}.${key}`, schemaDir)));
          }
        }
      }
      for (const [key, child] of Object.entries(schema.properties)) {
        if (key in value) {
          errors.push(...(await this.validateNode(value[key], child, `${path}.${key}`, schemaDir)));
        }
      }
    }
    if (schema.type === "array" && schema.items && Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        errors.push(...(await this.validateNode(item, schema.items, `${path}[${index}]`, schemaDir)));
      }
    }
    return errors;
  }
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "integer") {
    return Number.isInteger(value);
  }
  if (type === "object") {
    return isRecord(value);
  }
  return typeof value === type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
