import type { PermissionCheckResult } from "./permissions.js";
import type { RuntimeCapability, RuntimeType } from "./task-types.js";
import type { BaseTaskInput, TaskResult } from "./task-types.js";
import { checkTaskPermissions } from "./permissions.js";

export interface AgentRuntime {
  runCodeTask(input: BaseTaskInput): Promise<TaskResult>;
  runAnalysisTask(input: BaseTaskInput): Promise<TaskResult>;
  runRepairTask(input: BaseTaskInput): Promise<TaskResult>;
}

export type RuntimeExecutor = (input: BaseTaskInput) =>
  Promise<Omit<TaskResult, "permission_audit">>;
export type RuntimeExecutorKey = `${RuntimeType}:${RuntimeCapability}`;

/**
 * 按 runtime_capability 分派执行器
 * code_task / analysis_task / repair_task 各自独立
 */
export type ExecutorMap = Partial<Record<RuntimeCapability | RuntimeExecutorKey, RuntimeExecutor>>;

export class PolicyCheckedAgentRuntime implements AgentRuntime {
  private readonly executors: ExecutorMap;

  constructor(
    executors: Partial<ExecutorMap> = {},
    fallback: RuntimeExecutor = defaultExecutor
  ) {
    this.executors = {
      ...executors,
      code_task: executors.code_task ?? fallback,
      analysis_task: executors.analysis_task ?? fallback,
      repair_task: executors.repair_task ?? fallback,
    };
  }

  runCodeTask(input: BaseTaskInput): Promise<TaskResult> {
    return this.run(input, "code_task");
  }

  runAnalysisTask(input: BaseTaskInput): Promise<TaskResult> {
    return this.run(input, "analysis_task");
  }

  runRepairTask(input: BaseTaskInput): Promise<TaskResult> {
    return this.run(input, "repair_task");
  }

  private async run(
    input: BaseTaskInput,
    capability: RuntimeCapability
  ): Promise<TaskResult> {
    if (input.runtime_capability !== capability) {
      return blockedResult(input, {
        allowed: false,
        blocked_tools: [],
        error: {
          code: "CONFIGURATION_INVALID",
          message: "Runtime capability does not match the selected task entrypoint.",
          retryable: false,
          severity: "error",
          details: {
            expected_runtime_capability: capability,
            actual_runtime_capability: input.runtime_capability,
            runtime_type: input.runtime_type
          }
        }
      });
    }

    const permission = checkTaskPermissions(input);
    if (!permission.allowed) {
      return blockedResult(input, permission);
    }

    const executor = this.executors[`${input.runtime_type}:${capability}`] ?? this.executors[capability];
    if (!executor) {
      return blockedResult(input, {
        allowed: false,
        blocked_tools: [],
        error: {
          code: "MODEL_NOT_CONFIGURED",
          message: `No executor configured for capability: ${capability}`,
          retryable: false,
          severity: "warning",
          details: { runtime_capability: capability },
        },
      });
    }

    const result = await withTimeout(
      executor(input),
      input.runtime_policy.timeout_ms,
      timeoutResult(input)
    );
    return {
      ...result,
      permission_audit: {
        profile: input.permission_profile,
        blocked_tools: [],
      },
    };
  }
}

// --------------- helpers ---------------

function blockedResult(
  input: BaseTaskInput,
  permission: PermissionCheckResult
): TaskResult {
  return {
    task_id: input.task_id,
    status: "blocked",
    output: "",
    artifact_refs: [],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    permission_audit: {
      profile: input.permission_profile,
      blocked_tools: permission.blocked_tools,
    },
    error: permission.error,
  };
}

function timeoutResult(input: BaseTaskInput): Omit<
  TaskResult,
  "permission_audit"
> {
  return {
    task_id: input.task_id,
    status: "timed_out",
    output: "",
    artifact_refs: [],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    error: {
      code: "UPSTREAM_UNAVAILABLE",
      message: "Runtime task timed out.",
      retryable: true,
      severity: "error",
      details: {
        timeout_ms: input.runtime_policy.timeout_ms,
        runtime_type: input.runtime_type,
        runtime_capability: input.runtime_capability,
      },
    },
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function defaultExecutor(
  input: BaseTaskInput
): Promise<Omit<TaskResult, "permission_audit">> {
  return {
    task_id: input.task_id,
    status: "blocked",
    output: "Runtime executor is not configured.",
    artifact_refs: [],
    token_usage: { input_tokens: 0, output_tokens: 0 },
    error: {
      code: "MODEL_NOT_CONFIGURED",
      message: "Runtime executor is not configured.",
      retryable: false,
      severity: "warning",
      details: {
        runtime_type: input.runtime_type,
        runtime_capability: input.runtime_capability,
      },
    },
  };
}
