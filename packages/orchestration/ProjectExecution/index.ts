import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";
import type { ExecutionPlan } from "../../agents/BossPlanning";
import type { AgentRuntime } from "../../agents/Runtime";

export type ProjectExecutionStatus =
  | "running"
  | "blocked"
  | "no_worker"
  | "escalated"
  | "denied"
  | "completed"
  | "rejected";

export interface ProjectExecutionResult {
  decision: "STARTED" | "REJECTED";
  planId: string;
  status: ProjectExecutionStatus;
  tasks: Task[];
  scheduledTasks: Task[];
  blockedTasks: Task[];
  escalatedTask: Task | null;
  approvalRequestId: string | null;
  deniedTask: Task | null;
  reason: string;
}

export class ProjectExecutionService {
  private readonly taskMaps = new Map<string, Map<string, Task>>();
  private readonly managerIds = new Map<string, string>();

  constructor(private readonly runtime: AgentRuntime) {}

  start(
    plan: ExecutionPlan,
    tasks: Task[],
    manager: Agent,
    riskScore = 0
  ): ProjectExecutionResult {
    const validationError = this.validate(
      plan,
      tasks,
      manager
    );

    if (validationError) {
      return this.rejected(plan.id, validationError);
    }

    if (this.taskMaps.has(plan.id)) {
      return this.rejected(
        plan.id,
        `Project execution already started: ${plan.id}`
      );
    }

    const taskMap = new Map(
      tasks.map((task) => [task.id, task])
    );

    this.taskMaps.set(plan.id, taskMap);
    this.managerIds.set(plan.id, manager.id);

    return this.run(plan.id, manager, riskScore);
  }

  resume(
    planId: string,
    manager: Agent,
    riskScore = 0
  ): ProjectExecutionResult {
    const taskMap = this.taskMaps.get(planId);

    if (!taskMap) {
      return this.rejected(
        planId,
        `Project execution not found: ${planId}`
      );
    }

    if (this.managerIds.get(planId) !== manager.id) {
      return this.rejected(
        planId,
        "Manager does not own this project execution"
      );
    }

    return this.run(planId, manager, riskScore);
  }

  getTasks(planId: string): Task[] | undefined {
    const taskMap = this.taskMaps.get(planId);

    return taskMap ? Array.from(taskMap.values()) : undefined;
  }

  private run(
    planId: string,
    manager: Agent,
    riskScore: number
  ): ProjectExecutionResult {
    const taskMap = this.taskMaps.get(planId)!;
    const scheduledTasks: Task[] = [];

    while (true) {
      const result = this.runtime.schedule(
        taskMap,
        manager,
        riskScore
      );

      if (result.decision === "SCHEDULED" && result.task) {
        taskMap.set(result.task.id, result.task);
        scheduledTasks.push(result.task);

        if (
          Array.from(taskMap.values()).every(
            (task) => task.status !== "queued"
          )
        ) {
          return this.result(
            planId,
            "running",
            taskMap,
            scheduledTasks,
            [],
            null,
            null,
            null,
            "All currently queued tasks were scheduled"
          );
        }

        continue;
      }

      const blockedTasks = Array.from(taskMap.values()).filter(
        (task) => task.status === "queued"
      );

      if (result.decision === "ESCALATE") {
        return this.result(
          planId,
          "escalated",
          taskMap,
          scheduledTasks,
          blockedTasks,
          result.task,
          result.approvalRequestId,
          null,
          result.reason
        );
      }

      if (result.decision === "DENY") {
        return this.result(
          planId,
          "denied",
          taskMap,
          scheduledTasks,
          blockedTasks,
          null,
          null,
          result.task,
          result.reason
        );
      }

      if (result.decision === "NO_WORKER") {
        return this.result(
          planId,
          "no_worker",
          taskMap,
          scheduledTasks,
          blockedTasks,
          null,
          null,
          null,
          result.reason
        );
      }

      return this.result(
        planId,
        "blocked",
        taskMap,
        scheduledTasks,
        blockedTasks,
        null,
        null,
        null,
        result.reason
      );
    }
  }

  private validate(
    plan: ExecutionPlan,
    tasks: Task[],
    manager: Agent
  ): string | null {
    if (!plan.id.trim()) {
      return "Plan ID is required";
    }

    if (plan.tasks.length === 0) {
      return "Plan must contain at least one task";
    }

    const registeredManager = this.runtime.getAgent(manager.id);

    if (!registeredManager || registeredManager.role !== "manager") {
      return "Manager must be a registered manager";
    }

    if (!registeredManager.managerId) {
      return "Manager must belong to a Boss hierarchy";
    }

    const boss = this.runtime.getAgent(registeredManager.managerId);

    if (!boss || boss.role !== "boss") {
      return "Manager must belong to a registered Boss hierarchy";
    }

    const taskIds = new Set<string>();

    for (const task of tasks) {
      if (taskIds.has(task.id)) {
        return `Duplicate task ID: ${task.id}`;
      }

      taskIds.add(task.id);
    }

    if (
      tasks.length !== plan.tasks.length ||
      plan.tasks.some((plannedTask) => !taskIds.has(plannedTask.id)) ||
      tasks.some(
        (task) =>
          !plan.tasks.some((plannedTask) => plannedTask.id === task.id)
      )
    ) {
      return "Task collection does not match execution plan";
    }

    return null;
  }

  private result(
    planId: string,
    status: ProjectExecutionStatus,
    taskMap: Map<string, Task>,
    scheduledTasks: Task[],
    blockedTasks: Task[],
    escalatedTask: Task | null,
    approvalRequestId: string | null,
    deniedTask: Task | null,
    reason: string
  ): ProjectExecutionResult {
    return {
      decision: "STARTED",
      planId,
      status,
      tasks: Array.from(taskMap.values()),
      scheduledTasks,
      blockedTasks,
      escalatedTask,
      approvalRequestId,
      deniedTask,
      reason,
    };
  }

  private rejected(
    planId: string,
    reason: string
  ): ProjectExecutionResult {
    return {
      decision: "REJECTED",
      planId,
      status: "rejected",
      tasks: [],
      scheduledTasks: [],
      blockedTasks: [],
      escalatedTask: null,
      approvalRequestId: null,
      deniedTask: null,
      reason,
    };
  }
}