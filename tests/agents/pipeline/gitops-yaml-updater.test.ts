import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ArtifactStore, ArtifactWriteInput } from "../../../src/common/artifact-store.js";
import { createUnifiedDiff, GitOpsYamlUpdater } from "../../../src/agents/pipeline/gitops-yaml-updater.js";
import type { PipelineAgentConfig } from "../../../src/agents/pipeline/types.js";

test("updates deployment image in configured application environment yaml", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "fde-yaml-"));
  try {
    await mkdir(join(repoDir, "api-gateway"), { recursive: true });
    const yamlPath = join(repoDir, "api-gateway", "test.yaml");
    await writeFile(
      yamlPath,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "spec:",
        "  template:",
        "    spec:",
        "      containers:",
        "        - name: api-gateway",
        "          image: registry.example.com/team/api-gateway:old-tag",
        ""
      ].join("\n"),
      "utf8"
    );

    const updater = new GitOpsYamlUpdater(baseConfig);
    const result = await updater.updateImage({
      repoDir,
      application: "api-gateway",
      environment: "test",
      image_name: "registry.example.com/team/api-gateway",
      image_tag: "new-tag"
    });

    assert.equal(result.status, "changed");
    assert.deepEqual(result.changed_files, ["api-gateway/test.yaml"]);
    const updated = await readFile(yamlPath, "utf8");
    assert.match(updated, /image: registry\.example\.com\/team\/api-gateway:new-tag/);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("returns unchanged when yaml already contains target image", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "fde-yaml-"));
  try {
    await mkdir(join(repoDir, "api-gateway"), { recursive: true });
    await writeFile(
      join(repoDir, "api-gateway", "dev.yaml"),
      "spec:\n  template:\n    spec:\n      containers:\n        - image: registry.example.com/team/api-gateway:same-tag\n",
      "utf8"
    );

    const updater = new GitOpsYamlUpdater(baseConfig);
    const result = await updater.updateImage({
      repoDir,
      application: "api-gateway",
      environment: "dev",
      image_name: "registry.example.com/team/api-gateway",
      image_tag: "same-tag"
    });

    assert.equal(result.status, "unchanged");
    assert.deepEqual(result.changed_files, []);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("returns error when configured image is not found in yaml", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "fde-yaml-"));
  try {
    await mkdir(join(repoDir, "api-gateway"), { recursive: true });
    await writeFile(
      join(repoDir, "api-gateway", "dev.yaml"),
      "spec:\n  template:\n    spec:\n      containers:\n        - image: registry.example.com/team/other-service:old-tag\n",
      "utf8"
    );

    const updater = new GitOpsYamlUpdater(baseConfig);
    const result = await updater.updateImage({
      repoDir,
      application: "api-gateway",
      environment: "dev",
      image_name: "registry.example.com/team/api-gateway",
      image_tag: "new-tag"
    });

    assert.equal(result.status, "error");
    assert.equal(result.error?.code, "SCHEMA_VALIDATION_FAILED");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("writes a yaml diff artifact for single container image updates", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "fde-yaml-"));
  try {
    await mkdir(join(repoDir, "api-gateway"), { recursive: true });
    await writeFile(
      join(repoDir, "api-gateway", "dev.yaml"),
      [
        "spec:",
        "  template:",
        "    spec:",
        "      containers:",
        "        - name: api-gateway",
        "          image: registry.example.com/team/api-gateway:old-tag",
        ""
      ].join("\n"),
      "utf8"
    );
    const artifactStore = new CaptureArtifactStore();
    const updater = new GitOpsYamlUpdater(baseConfig, artifactStore);

    const result = await updater.updateImage({
      repoDir,
      application: "api-gateway",
      environment: "dev",
      image_name: "registry.example.com/team/api-gateway",
      image_tag: "new-tag",
      build_id: "build-001",
      run_id: "run-001"
    });

    assert.equal(result.status, "changed");
    assert.equal(result.diff_artifact_uri, "artifacts/runs/run-001/yaml.diff");
    assert.equal(artifactStore.writes.length, 1);
    assert.equal(artifactStore.writes[0].run_id, "run-001");
    assert.equal(artifactStore.writes[0].artifact_type, "diff");
    assert.equal(artifactStore.writes[0].content_type, "text/plain");
    assert.match(String(artifactStore.writes[0].content), /--- a\/api-gateway\/dev\.yaml/);
    assert.match(String(artifactStore.writes[0].content), /@@ -1,6 \+1,6 @@/);
    assert.match(String(artifactStore.writes[0].content), / spec:/);
    assert.match(String(artifactStore.writes[0].content), /-          image: registry\.example\.com\/team\/api-gateway:old-tag/);
    assert.match(String(artifactStore.writes[0].content), /\+          image: registry\.example\.com\/team\/api-gateway:new-tag/);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("creates a complete unified diff for inserted and deleted lines", () => {
  const diff = createUnifiedDiff(
    "api-gateway/dev.yaml",
    ["apiVersion: apps/v1", "kind: Deployment", "metadata:", "  name: old-name", "spec:"].join("\n"),
    ["apiVersion: apps/v1", "metadata:", "  name: api-gateway", "  labels:", "    app: api-gateway", "spec:"].join("\n")
  );

  assert.match(diff, /--- a\/api-gateway\/dev\.yaml/);
  assert.match(diff, /\+\+\+ b\/api-gateway\/dev\.yaml/);
  assert.match(diff, /@@ -1,5 \+1,6 @@/);
  assert.match(diff, / apiVersion: apps\/v1/);
  assert.match(diff, /-kind: Deployment/);
  assert.match(diff, /-  name: old-name/);
  assert.match(diff, /\+  name: api-gateway/);
  assert.match(diff, /\+  labels:/);
  assert.match(diff, /\+    app: api-gateway/);
  assert.match(diff, / spec:/);
});

class CaptureArtifactStore implements ArtifactStore {
  readonly writes: ArtifactWriteInput[] = [];

  async write(input: ArtifactWriteInput) {
    this.writes.push(input);
    return {
      artifact_uri: input.artifact_uri ?? "artifacts/runs/unscoped/diff.txt",
      artifact_type: input.artifact_type,
      content_type: input.content_type
    };
  }

  async read(): Promise<Buffer> {
    return Buffer.from("");
  }
}

const baseConfig: PipelineAgentConfig = {
  gitops_repo_url: "https://gitlab.example.com/group/config.git",
  gitops_repo_branch: "main",
  image_field_path: "spec.template.spec.containers[0].image",
  yaml_file_name: "{environment}.yaml",
  git_user_name: "fde-pipeline-bot",
  git_user_email: "fde-pipeline-bot@example.com",
  working_directory: "C:/work",
  max_retries: 3,
  retry_delay_ms: 1000
};
