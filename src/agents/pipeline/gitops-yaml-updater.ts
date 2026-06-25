import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactStore } from "../../common/artifact-store.js";
import type { Environment } from "../../common/contracts.js";
import type { PipelineAgentConfig, YamlUpdateResult } from "./types.js";

export interface UpdateImageInput {
  repoDir: string;
  application: string;
  environment: Environment;
  image_name: string;
  image_tag: string;
  build_id?: string;
  run_id?: string;
}

export class GitOpsYamlUpdater {
  constructor(
    private readonly config: PipelineAgentConfig,
    private readonly artifactStore?: ArtifactStore
  ) {}

  async updateImage(input: UpdateImageInput): Promise<YamlUpdateResult> {
    if (this.config.image_field_path !== "spec.template.spec.containers[0].image") {
      return {
        status: "error",
        config_repo: input.repoDir,
        changed_files: [],
        error: {
          code: "SCHEMA_VALIDATION_FAILED",
          message: `Unsupported image field path: ${this.config.image_field_path}`,
          retryable: false,
          severity: "error",
          details: {
            supported_path: "spec.template.spec.containers[0].image"
          }
        }
      };
    }

    const relativePath = `${input.application}/${this.config.yaml_file_name.replace("{environment}", input.environment)}`;
    const yamlPath = join(input.repoDir, relativePath);
    const current = await readFile(yamlPath, "utf8");
    const targetImage = `${input.image_name}:${input.image_tag}`;
    const update = replaceFirstImage(current, input.image_name, targetImage);

    if (!update.matched) {
      return {
        status: "error",
        config_repo: input.repoDir,
        changed_files: [],
        error: {
          code: "SCHEMA_VALIDATION_FAILED",
          message: `Image ${input.image_name} was not found in ${relativePath}`,
          retryable: false,
          severity: "error",
          details: {
            file: relativePath,
            image_name: input.image_name
          }
        }
      };
    }

    if (update.content === current) {
      return {
        status: "unchanged",
        config_repo: input.repoDir,
        changed_files: []
      };
    }

    await writeFile(yamlPath, update.content, "utf8");
    const diffArtifactUri = await this.writeDiffArtifact(input, relativePath, current, update.content);

    return {
      status: "changed",
      config_repo: input.repoDir,
      changed_files: [relativePath.replaceAll("\\", "/")],
      diff_artifact_uri: diffArtifactUri,
      commit_message: createCommitMessage(input.application, input.image_tag, input.build_id)
    };
  }

  private async writeDiffArtifact(
    input: UpdateImageInput,
    relativePath: string,
    before: string,
    after: string
  ): Promise<string | undefined> {
    const artifactRunId = input.run_id ?? input.build_id;
    if (!this.artifactStore || !artifactRunId) {
      return undefined;
    }

    const artifactUri = `artifacts/runs/${artifactRunId}/yaml.diff`;
    await this.artifactStore.write({
      run_id: artifactRunId,
      artifact_uri: artifactUri,
      artifact_type: "diff",
      content_type: "text/plain",
      content: createUnifiedDiff(relativePath.replaceAll("\\", "/"), before, after)
    });
    return artifactUri;
  }
}

function replaceFirstImage(content: string, imageName: string, targetImage: string): { content: string; matched: boolean } {
  const imageLine = /^(\s*(?:-\s*)?image:\s*)(['"]?)([^'"\s#]+)(['"]?)(.*)$/gm;
  let replaced = false;
  const updated = content.replace(imageLine, (line, prefix: string, quote: string, value: string, endQuote: string, suffix: string) => {
    if (replaced) {
      return line;
    }
    const currentName = value.includes(":") ? value.slice(0, value.lastIndexOf(":")) : value;
    if (currentName !== imageName) {
      return line;
    }
    replaced = true;
    return `${prefix}${quote}${targetImage}${endQuote || quote}${suffix}`;
  });
  return {
    content: updated,
    matched: replaced
  };
}

function createCommitMessage(application: string, imageTag: string, buildId?: string): string {
  const lines = [`chore(deploy): update ${application} image to ${imageTag}`];
  if (buildId) {
    lines.push("", `build_id: ${buildId}`);
  }
  return lines.join("\n");
}

export function createUnifiedDiff(relativePath: string, before: string, after: string): string {
  const beforeLines = splitContentLines(before);
  const afterLines = splitContentLines(after);
  const diffLines = createLineDiff(beforeLines, afterLines);
  const oldStart = beforeLines.length > 0 ? 1 : 0;
  const newStart = afterLines.length > 0 ? 1 : 0;

  return [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -${oldStart},${beforeLines.length} +${newStart},${afterLines.length} @@`,
    ...diffLines
  ].join("\n") + "\n";
}

function splitContentLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split(/\r?\n/);
}

function createLineDiff(beforeLines: string[], afterLines: string[]): string[] {
  const lcs = createLcsMatrix(beforeLines, afterLines);
  const output: string[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    if (
      beforeIndex < beforeLines.length &&
      afterIndex < afterLines.length &&
      beforeLines[beforeIndex] === afterLines[afterIndex]
    ) {
      output.push(` ${beforeLines[beforeIndex]}`);
      beforeIndex += 1;
      afterIndex += 1;
    } else if (
      afterIndex < afterLines.length &&
      (beforeIndex === beforeLines.length || lcs[beforeIndex][afterIndex + 1] > lcs[beforeIndex + 1][afterIndex])
    ) {
      output.push(`+${afterLines[afterIndex]}`);
      afterIndex += 1;
    } else if (beforeIndex < beforeLines.length) {
      output.push(`-${beforeLines[beforeIndex]}`);
      beforeIndex += 1;
    }
  }

  return output;
}

function createLcsMatrix(beforeLines: string[], afterLines: string[]): number[][] {
  const matrix = Array.from(
    { length: beforeLines.length + 1 },
    () => Array.from({ length: afterLines.length + 1 }, () => 0)
  );

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      matrix[beforeIndex][afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? matrix[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(matrix[beforeIndex + 1][afterIndex], matrix[beforeIndex][afterIndex + 1]);
    }
  }

  return matrix;
}
