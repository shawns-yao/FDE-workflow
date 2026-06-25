import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PipelineAgentConfig } from "./types.js";

const execFileAsync = promisify(execFile);

export interface GitCommandOptions {
  cwd: string;
  env?: Record<string, string>;
}

export type GitCommandExecutor = (
  command: string,
  args: string[],
  options: GitCommandOptions
) => Promise<{ stdout: string; stderr: string }>;

export class GitOperations {
  constructor(
    private readonly config: PipelineAgentConfig,
    private readonly execute: GitCommandExecutor = defaultGitExecutor
  ) {}

  async clone(repoUrl: string, targetDir: string): Promise<void> {
    await this.git(["clone", repoUrl, targetDir], this.config.working_directory, this.authEnv());
  }

  async pull(branch: string, cwd: string): Promise<void> {
    await this.git(["pull", "origin", branch], cwd, this.authEnv());
  }

  async add(files: string[], cwd: string): Promise<void> {
    await this.git(["add", ...files], cwd);
  }

  async commit(message: string, cwd: string): Promise<void> {
    await this.git(["commit", "-m", message], cwd);
  }

  async push(branch: string, cwd: string): Promise<void> {
    await this.git(["push", "origin", branch], cwd, this.authEnv());
  }

  async discardChanges(cwd: string, files: string[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    await this.git(["restore", "--staged", "--worktree", "--", ...files], cwd);
  }

  async getCommitSha(cwd: string): Promise<string> {
    const { stdout } = await this.git(["rev-parse", "HEAD"], cwd);
    return stdout.trim();
  }

  async getStatus(cwd: string): Promise<string> {
    const { stdout } = await this.git(["status", "--porcelain"], cwd);
    return stdout.trim();
  }

  async configureUser(cwd: string): Promise<void> {
    await this.git(["config", "user.name", this.config.git_user_name], cwd);
    await this.git(["config", "user.email", this.config.git_user_email], cwd);
  }

  async repoExists(dirPath: string): Promise<boolean> {
    try {
      await this.git(["rev-parse", "--git-dir"], dirPath);
      return true;
    } catch {
      return false;
    }
  }

  getRepositoryDir(workDir: string): string {
    return `${workDir}/gitops-config`;
  }

  async ensureRepository(repoUrl: string, branch: string, workDir: string): Promise<string> {
    const repoDir = this.getRepositoryDir(workDir);
    if (!(await this.repoExists(repoDir))) {
      await this.clone(repoUrl, repoDir);
    } else {
      await this.pull(branch, repoDir);
    }
    return repoDir;
  }

  async commitAndPush(
    branch: string,
    cwd: string,
    files: string[],
    commitMessage: string
  ): Promise<{ success: boolean; commitSha?: string; error?: string }> {
    try {
      await this.configureUser(cwd);
      await this.add(files, cwd);

      const status = await this.getStatus(cwd);
      if (!status) {
        return { success: true, commitSha: await this.getCommitSha(cwd) };
      }

      await this.commit(commitMessage, cwd);
      await this.push(branch, cwd);

      return { success: true, commitSha: await this.getCommitSha(cwd) };
    } catch (error) {
      return {
        success: false,
        error: this.redactError(error)
      };
    }
  }

  async executeUpdate(
    repoUrl: string,
    branch: string,
    workDir: string,
    files: string[],
    commitMessage: string
  ): Promise<{ success: boolean; commitSha?: string; error?: string }> {
    try {
      const repoDir = await this.ensureRepository(repoUrl, branch, workDir);
      return await this.commitAndPush(branch, repoDir, files, commitMessage);
    } catch (error) {
      return {
        success: false,
        error: this.redactError(error)
      };
    }
  }

  private git(args: string[], cwd: string, env?: Record<string, string>) {
    return this.execute("git", args, {
      cwd,
      env
    });
  }

  private authEnv(): Record<string, string> | undefined {
    if (!this.config.gitops_repo_token) {
      return undefined;
    }
    return {
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Bearer ${this.config.gitops_repo_token}`
    };
  }

  private redactError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (!this.config.gitops_repo_token) {
      return message;
    }
    return message.split(this.config.gitops_repo_token).join("[REDACTED]");
  }
}

async function defaultGitExecutor(command: string, args: string[], options: GitCommandOptions): Promise<{ stdout: string; stderr: string }> {
  const env = options.env ? { ...process.env, ...options.env } : process.env;
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
    env
  });
  return {
    stdout,
    stderr
  };
}
