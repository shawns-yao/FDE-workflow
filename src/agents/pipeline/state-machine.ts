import { randomUUID } from "node:crypto";
import type {
  PipelineStatus,
  PipelineTask,
  PipelineEventType,
} from "./types.js";
import { loadZhMessages } from "../../i18n/messages.js";

// 状态转换规则
const stateTransitions: Record<PipelineStatus, PipelineStatus[]> = {
  pending: ["updating"],
  updating: ["syncing", "failed"],
  syncing: ["success", "failed"],
  success: [],
  failed: ["retrying", "updating"],
  retrying: ["updating"],
};

// 状态对应的事件类型
const statusToEvent: Record<PipelineStatus, PipelineEventType> = {
  pending: "pipeline.build.completed",
  updating: "gitops.yaml.updated",
  syncing: "gitops.yaml.updated",
  success: "pipeline.build.completed",
  failed: "pipeline.deployment.failed",
  retrying: "pipeline.deployment.failed",
};

export interface StateTransition {
  from: PipelineStatus;
  to: PipelineStatus;
  timestamp: string;
  reason?: string;
}

export interface StateMachineResult {
  success: boolean;
  newStatus: PipelineStatus;
  event: PipelineEventType;
  transition: StateTransition;
  error?: string;
}

export class PipelineStateMachine {
  private tasks: Map<string, PipelineTask> = new Map();
  private transitions: Map<string, StateTransition[]> = new Map();

  // 创建新任务
  createTask(
    buildId: string,
    application: string,
    environment: string,
    imageTag: string,
    commitSha: string,
    pipelineRunId: string,
    trigger: "manual" | "webhook" | "schedule"
  ): PipelineTask {
    const now = new Date().toISOString();
    const task: PipelineTask = {
      task_id: randomUUID(),
      build_id: buildId,
      application,
      environment: environment as any,
      image_name: "",
      image_tag: imageTag,
      commit_sha: commitSha,
      pipeline_run_id: pipelineRunId,
      status: "pending",
      created_at: now,
      updated_at: now,
      trigger,
    };

    this.tasks.set(task.task_id, task);
    this.transitions.set(task.task_id, []);

    return task;
  }

  // 获取任务
  getTask(taskId: string): PipelineTask | undefined {
    return this.tasks.get(taskId);
  }

  // 根据 buildId 获取任务
  getTaskByBuildId(buildId: string): PipelineTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.build_id === buildId) {
        return task;
      }
    }
    return undefined;
  }

  // 执行状态转换
  transition(
    taskId: string,
    toStatus: PipelineStatus,
    reason?: string
  ): StateMachineResult {
    const task = this.tasks.get(taskId);
    if (!task) {
      return {
        success: false,
        newStatus: "pending",
        event: "pipeline.build.completed",
        transition: {
          from: "pending",
          to: toStatus,
          timestamp: new Date().toISOString(),
          reason: "task not found",
        },
        error: `Task ${taskId} not found`,
      };
    }

    const fromStatus = task.status;
    const allowedTransitions = stateTransitions[fromStatus];

    if (!allowedTransitions.includes(toStatus)) {
      return {
        success: false,
        newStatus: fromStatus,
        event: statusToEvent[fromStatus],
        transition: {
          from: fromStatus,
          to: toStatus,
          timestamp: new Date().toISOString(),
          reason: "invalid transition",
        },
        error: `Cannot transition from ${fromStatus} to ${toStatus}`,
      };
    }

    // 更新任务状态
    task.status = toStatus;
    task.updated_at = new Date().toISOString();

    // 记录转换
    const transition: StateTransition = {
      from: fromStatus,
      to: toStatus,
      timestamp: task.updated_at,
      reason,
    };

    const taskTransitions = this.transitions.get(taskId) || [];
    taskTransitions.push(transition);
    this.transitions.set(taskId, taskTransitions);

    return {
      success: true,
      newStatus: toStatus,
      event: statusToEvent[toStatus],
      transition,
    };
  }

  // 快捷方法：开始更新
  startUpdating(taskId: string): StateMachineResult {
    return this.transition(taskId, "updating", loadZhMessages().pipeline.transition_reasons.start_updating);
  }

  // 快捷方法：开始同步
  startSyncing(taskId: string): StateMachineResult {
    return this.transition(taskId, "syncing", loadZhMessages().pipeline.transition_reasons.start_syncing);
  }

  // 快捷方法：完成
  complete(taskId: string): StateMachineResult {
    return this.transition(taskId, "success", loadZhMessages().pipeline.transition_reasons.complete);
  }

  // 快捷方法：失败
  fail(taskId: string, reason?: string): StateMachineResult {
    return this.transition(taskId, "failed", reason);
  }

  // 快捷方法：重试
  retry(taskId: string): StateMachineResult {
    return this.transition(taskId, "retrying", loadZhMessages().pipeline.transition_reasons.retrying);
  }

  // 获取任务转换历史
  getTransitions(taskId: string): StateTransition[] {
    return this.transitions.get(taskId) || [];
  }

  // 检查是否可以转换到目标状态
  canTransition(taskId: string, toStatus: PipelineStatus): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const allowedTransitions = stateTransitions[task.status];
    return allowedTransitions.includes(toStatus);
  }

  // 获取所有任务
  getAllTasks(): PipelineTask[] {
    return Array.from(this.tasks.values());
  }

  // 获取指定状态的所有任务
  getTasksByStatus(status: PipelineStatus): PipelineTask[] {
    return this.getAllTasks().filter((task) => task.status === status);
  }
}
