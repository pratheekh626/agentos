import type { AgentRegistry } from "../AgentRegistry";
import type { Project } from "../ProjectIntake";
import type { StructuredRequirement } from "../RequirementUnderstanding";
import type { TaskPriority } from "../../core/Task";

export interface PlannedTask {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  budget: number;
  dependencies: string[];
}

export interface ExecutionPlan {
  id: string;
  projectId: string;
  plannedBy: string;
  tasks: PlannedTask[];
  createdAt: string;
}

export type PlanningDecision = "CREATED" | "REJECTED";

export interface PlanningResult {
  decision: PlanningDecision;
  plan: ExecutionPlan | null;
  reason: string;
}

export class BossPlanningService {
  private readonly plans = new Map<string, ExecutionPlan>();

  constructor(
    private readonly registry: AgentRegistry
  ) {}

  plan(
    planId: string,
    project: Project,
    requirement: StructuredRequirement,
    bossId: string,
    createdAt = new Date().toISOString()
  ): PlanningResult {
    if (!planId.trim()) {
      return this.rejected("Plan ID is required");
    }

    const boss = this.registry.get(bossId);

    if (!boss || boss.role !== "boss") {
      return this.rejected("Only a registered Boss can create a plan");
    }

    if (project.status !== "planned") {
      return this.rejected("Project is not ready for planning");
    }

    if (requirement.status !== "ready") {
      return this.rejected(
        "Requirement needs clarification before planning"
      );
    }

    if (
      project.requirementId !== requirement.id ||
      project.clientId !== requirement.clientId
    ) {
      return this.rejected(
        "Project and requirement relationships do not match"
      );
    }

    if (this.plans.has(planId)) {
      throw new Error(`Plan already exists: ${planId}`);
    }

    const requirementTasks = requirement.requirements.map(
      (item, index) => ({
        id: `${planId}-requirement-${index + 1}`,
        title: `Implement requirement: ${item}`,
        description: item,
        priority: requirement.priority,
        budget: 0,
        dependencies: [],
      })
    );
    const requirementTaskIds = requirementTasks.map(
      (task) => task.id
    );
    const deliverableTasks = requirement.deliverables.map(
      (item, index) => ({
        id: `${planId}-deliverable-${index + 1}`,
        title: `Deliver: ${item}`,
        description: item,
        priority: requirement.priority,
        budget: 0,
        dependencies: [...requirementTaskIds],
      })
    );

    const plan: ExecutionPlan = {
      id: planId,
      projectId: project.id,
      plannedBy: boss.id,
      tasks: [...requirementTasks, ...deliverableTasks],
      createdAt,
    };

    this.plans.set(plan.id, plan);

    return {
      decision: "CREATED",
      plan,
      reason: "Boss execution plan created",
    };
  }

  get(planId: string): ExecutionPlan | undefined {
    return this.plans.get(planId);
  }

  getAll(): ExecutionPlan[] {
    return Array.from(this.plans.values());
  }

  private rejected(reason: string): PlanningResult {
    return {
      decision: "REJECTED",
      plan: null,
      reason,
    };
  }
}