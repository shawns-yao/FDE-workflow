import test from "node:test";
import assert from "node:assert/strict";
import { HttpArgoCdSyncController } from "../../../src/agents/pipeline/argocd-sync-controller.js";
import type { ArgoCdSyncFetch } from "../../../src/agents/pipeline/argocd-sync-controller.js";
import type { PipelineAgentConfig, BuildCompletedPayload } from "../../../src/agents/pipeline/types.js";

test("argocd sync controller reports configuration errors when endpoint or token is missing", async () => {
  const controller = new HttpArgoCdSyncController(baseConfig, async () => {
    throw new Error("fetch must not be called");
  });

  const result = await controller.sync({ build: buildPayload });

  assert.equal(result.sync_status, "skipped");
  assert.equal(result.error?.code, "CONFIGURATION_INVALID");
  assert.equal(result.error?.retryable, false);
});

test("argocd sync controller posts application sync request with bearer token", async () => {
  const calls: Array<{ url: string; authorization?: string; body: string }> = [];
  const fetchImpl: ArgoCdSyncFetch = async (url, init) => {
    calls.push({
      url,
      authorization: init.headers.Authorization,
      body: init.body
    });
    return {
      ok: true,
      status: 200
    };
  };
  const controller = new HttpArgoCdSyncController({
    ...baseConfig,
    argocd_api_url: "https://argocd.example.com/",
    argocd_token: "secret-token"
  }, fetchImpl);

  const result = await controller.sync({ build: buildPayload });

  assert.equal(result.sync_status, "triggered");
  assert.equal(result.argocd_application, "api-gateway-dev");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://argocd.example.com/api/v1/applications/api-gateway-dev/sync");
  assert.equal(calls[0].authorization, "Bearer secret-token");
  assert.deepEqual(JSON.parse(calls[0].body), {
    revision: buildPayload.commit_sha,
    prune: false,
    dryRun: false
  });
});

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

const buildPayload: BuildCompletedPayload = {
  application: "api-gateway",
  environment: "dev",
  image_name: "registry.example.com/team/api-gateway",
  image_tag: "5b24f0c212cfa1ba0eae5d497defb8d21879b0fc_1780371198",
  build_status: "succeeded",
  commit_sha: "5b24f0c212cfa1ba0eae5d497defb8d21879b0fc",
  pipeline_run_id: "api-gateway-run-001",
  build_id: "api-gateway-run-001",
  trigger: "webhook"
};
