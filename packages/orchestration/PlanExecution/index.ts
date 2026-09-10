import type { Task } from "../../core/Task";
import type { AgentRegistry } from "../../agents/AgentRegistry";
import type { ExecutionPlan, PlannedTask } from "../../agents/BossPlanning";
import { TaskDispatcher } from "../TaskDispatcher";

export type PlanExecutionDecision =
  | "EXECUTED"
  | "REJECTED";

export interface PlanExecutionResult {
  decision: PlanExecutionDecision;
  planId: string;
  tasks: Task[];
  reason: string;
}

export class PlanExecutionService {
  private readonly executedPlans = new Map<string, Task[]>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly taskDispatcher: TaskDispatcher
  ) {}

  execute(plan: ExecutionPlan): PlanExecutionResult {
    const validationError = this.validatePlan(plan);

    if (validationError) {
      return this.rejected(plan.id, validationError);
    }

    if (this.executedPlans.has(plan.id)) {
      return this.rejected(
        plan.id,
        `Plan already executed: ${plan.id}`
      );
    }

    const tasks = plan.tasks.map((plannedTask) => {
      const task = this.taskDispatcher.createTask(
        plannedTask.id,
        plannedTask.title,
        plannedTask.description,
        plan.plannedBy,
        plannedTask.priority,
        plannedTask.budget
      );

      return {
        ...task,
        dependencies: [...plannedTask.dependencies],
      };
    });

    this.executedPlans.set(plan.id, tasks);

    return {
      decision: "EXECUTED",
      planId: plan.id,
      tasks,
      reason: "Execution plan converted to queued tasks",
    };
  }

  get(planId: string): Task[] | undefined {
    return this.executedPlans.get(planId);
  }

  getAll(): Map<string, Task[]> {
    return new Map(this.executedPlans);
  }

  private validatePlan(plan: ExecutionPlan): string | null {
    if (!plan.id.trim()) {
      return "Plan ID is required";
    }

    if (plan.tasks.length === 0) {
      return "Plan must contain at least one task";
    }

    const boss = this.registry.get(plan.plannedBy);

    if (!boss || boss.role !== "boss") {
      return "Plan creator must be a registered Boss";
    }

    const taskIds = new Set<string>();

    for (const task of plan.tasks) {
      if (!task.id.trim()) {
        return "Planned task ID is required";
      }

      if (!task.title.trim()) {
        return `Planned task title is required: ${task.id}`;
      }

      if (taskIds.has(task.id)) {
        return `Duplicate planned task ID: ${task.id}`;
      }

      taskIds.add(task.id);
    }

    for (const task of plan.tasks) {
      const missingDependency = task.dependencies.find(
        (dependencyId) => !taskIds.has(dependencyId)
      );

      if (missingDependency) {
        return `Dependency not found in plan: ${missingDependency}`;
      }
    }

    return null;
  }

  private rejected(planId: string, reason: string): PlanExecutionResult {
    return {
      decision: "REJECTED",
      planId,
      tasks: [],
      reason,
    };
  }
}