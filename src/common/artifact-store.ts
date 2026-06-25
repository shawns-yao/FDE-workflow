import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { createId } from "./ids.js";
import type { ArtifactRef, ArtifactType } from "./contracts.js";

export interface ArtifactWriteInput {
  run_id?: string;
  artifact_uri?: string;
  artifact_type: ArtifactType;
  content_type: string;
  content: string | Buffer | object;
  excerpt?: string;
}

export interface ArtifactStore {
  write(input: ArtifactWriteInput): Promise<ArtifactRef>;
  read(artifactUri: string): Promise<Buffer>;
}

export class LocalArtifactStore implements ArtifactStore {
  private readonly resolvedRoot: string;

  constructor(private readonly rootDir = ".") {
    this.resolvedRoot = resolve(rootDir);
  }

  async write(input: ArtifactWriteInput): Promise<ArtifactRef> {
    const content = serializeContent(input.content, input.content_type);
    const artifactUri = input.artifact_uri ?? defaultArtifactUri(input);
    const absolutePath = this.resolveArtifactPath(artifactUri);

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);

    const info = await stat(absolutePath);
    return {
      artifact_id: createId("artifact"),
      artifact_uri: artifactUri,
      artifact_type: input.artifact_type,
      content_type: input.content_type,
      sha256: createHash("sha256").update(content).digest("hex"),
      size_bytes: info.size,
      created_at: new Date().toISOString(),
      excerpt: input.excerpt
    };
  }

  async read(artifactUri: string): Promise<Buffer> {
    return readFile(this.resolveArtifactPath(artifactUri));
  }

  private resolveArtifactPath(artifactUri: string): string {
    // 1. 拒绝绝对路径
    if (isAbsolute(artifactUri)) {
      throw new Error(`Artifact URI must be relative: ${artifactUri}`);
    }

    // 2. 拒绝编码后的路径遍历（URL编码）
    const decoded = decodeURIComponent(artifactUri);
    if (decoded !== artifactUri) {
      throw new Error(`Artifact URI contains encoded characters: ${artifactUri}`);
    }

    // 3. 拒绝包含.. 组件的路径
    const segments = artifactUri.split(/[/\\]/);
    for (const segment of segments) {
      if (segment === ".." || segment === ".") {
        throw new Error(`Artifact path contains invalid segment: ${segment} in ${artifactUri}`);
      }
    }

    // 4. 标准化后验证最终路径确实在根目录下
    const normalized = normalize(artifactUri);
    const resolvedPath = resolve(this.resolvedRoot, normalized);

    if (!resolvedPath.startsWith(this.resolvedRoot)) {
      throw new Error(`Artifact path escapes root directory: ${artifactUri}`);
    }

    return resolvedPath;
  }
}

function defaultArtifactUri(input: ArtifactWriteInput): string {
  const runId = input.run_id ?? "unscoped";
  const extension = input.content_type.includes("json") ? "json" : input.content_type.includes("markdown") ? "md" : "txt";
  return `artifacts/runs/${runId}/${input.artifact_type}-${Date.now()}.${extension}`;
}

function serializeContent(content: string | Buffer | object, contentType: string): Buffer {
  if (Buffer.isBuffer(content)) {
    return content;
  }
  if (typeof content === "string") {
    return Buffer.from(content);
  }
  const spacing = contentType.includes("json") ? 2 : 0;
  return Buffer.from(JSON.stringify(content, null, spacing));
}