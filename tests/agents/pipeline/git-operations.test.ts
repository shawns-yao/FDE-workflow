import test from "node:test";
import assert from "node:assert/strict";
import { GitOperations, type GitCommandExecutor } from "../../../src/agents/pipeline/git-operations.js";
import type { PipelineAgentConfig } from "../../../src/agents/pipeline/types.js";

test("git operations pass commands as argument arrays instead of shell strings", async () => {
  const calls: GitCommandCall[] = [];
  const git = new GitOperations(baseConfig, captureExecutor(calls));

  await git.add(["deploy/dev.yaml", "deploy/test.yaml"], "C:/work/repo");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "git");
  assert.deepEqual(calls[0].args, ["add", "deploy/dev.yaml", "deploy/test.yaml"]);
  assert.equal(calls[0].options.cwd, "C:/work/repo");
});

test("git clone keeps repository token out of command arguments", async () => {
  const calls: GitCommandCall[] = [];
  const git = new GitOperations(
    {
      ...baseConfig,
      gitops_repo_token: "secret-token"
    },
    captureExecutor(calls)
  );

  await git.clone("https://gitlab.example.com/group/config.git", "C:/work/config");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "git");
  assert.deepEqual(calls[0].args, ["clone", "https://gitlab.example.com/group/config.git", "C:/work/config"]);
  assert.equal(calls[0].options.env?.GIT_TERMINAL_PROMPT, "0");
  assert.equal(calls[0].options.env?.GIT_CONFIG_KEY_0, "http.extraHeader");
  assert.equal(calls[0].options.env?.GIT_CONFIG_VALUE_0, "Authorization: Bearer secret-token");
  assert.equal(JSON.stringify(calls[0].args).includes("secret-token"), false);
});

interface GitCommandCall {
  command: string;
  args: string[];
  options: Parameters<GitCommandExecutor>[2];
}

function captureExecutor(calls: GitCommandCall[]): GitCommandExecutor {
  return async (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout: "abc123\n", stderr: "" };
  };
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
