import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ErrorObject } from "../../common/contracts.js";
import { formatMessage, loadZhMessages } from "../../i18n/messages.js";
import { isCommandAllowed } from "../permissions.js";
import type { PermissionProfileName, RuntimeToolName } from "../task-types.js";
import type { CoreTool } from "./core-tool.js";

const execFileAsync = promisify(execFile);

export interface RunCommandInput {
  command: string;
  cwd: string;
  env?: Record<string, string>;
}

export interface RunCommandOutput {
  exit_code: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandContext {
  permission_profile: PermissionProfileName;
  allowed_tools: RuntimeToolName[];
}

export type RunCommandExecutor = (input: RunCommandInput) => Promise<RunCommandOutput>;

export type RunCommandToolResult =
  | {
      status: "succeeded";
      output: RunCommandOutput;
    }
  | {
      status: "blocked" | "failed";
      output?: RunCommandOutput;
      error: ErrorObject;
    };

export function createRunCommandTool(options: { execute?: RunCommandExecutor } = {}): CoreTool {
  const execute = options.execute ?? defaultRunCommandExecutor;
  const messages = loadZhMessages();
  return {
    name: "run_command" as const,
    description: "Run an allowlisted command without shell expansion.",
    input_schema: {
      type: "object",
      required: ["command", "cwd"],
      additionalProperties: false,
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        env: {
          type: "object",
          additionalProperties: { type: "string" }
        }
      }
    },
    async call(input: RunCommandInput, context: RunCommandContext): Promise<RunCommandToolResult> {
      const permissionError = validatePermission(input, context);
      if (permissionError) {
        return {
          status: "blocked",
          error: permissionError
        };
      }

      try {
        const output = await execute(input);
        return output.exit_code === 0
          ? {
              status: "succeeded",
              output
            }
          : {
              status: "failed",
              output,
              error: {
                code: "COMMAND_EXECUTION_FAILED",
                message: formatMessage(messages.runtime.run_command.execution_failed, { exit_code: output.exit_code }),
                retryable: output.exit_code !== 126 && output.exit_code !== 127,
                severity: "error",
                details: {
                  exit_code: output.exit_code,
                  command: input.command,
                  stderr: output.stderr.slice(0, 1000)
                }
              }
            };
      } catch (error) {
        return {
          status: "failed",
          error: {
            code: "COMMAND_TIMEOUT",
            message: error instanceof Error ? error.message : messages.runtime.run_command.execution_exception,
            retryable: false,
            severity: "error",
            details: {
              command: input.command
            }
          }
        };
      }
    }
  };
}

async function defaultRunCommandExecutor(input: RunCommandInput): Promise<RunCommandOutput> {
  const [command, ...args] = input.command.trim().split(/\s+/);
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: input.cwd,
    env: input.env ? { ...process.env, ...input.env } : process.env
  });
  return {
    exit_code: 0,
    stdout,
    stderr
  };
}

function validatePermission(input: RunCommandInput, context: RunCommandContext): ErrorObject | undefined {
  const messages = loadZhMessages();
  if (!context.allowed_tools.includes("run_command")) {
    return permissionError(input.command, messages.runtime.permissions.run_command_not_enabled);
  }
  if (!isCommandAllowed(context.permission_profile, input.command)) {
    return permissionError(input.command, messages.runtime.permissions.command_not_allowlisted);
  }
  return undefined;
}

function permissionError(command: string, message: string): ErrorObject {
  return {
    code: "TOOL_PERMISSION_DENIED",
    message,
    retryable: false,
    severity: "error",
    details: {
      command
    }
  };
}
