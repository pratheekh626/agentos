import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import {
  RequirementUnderstandingService,
} from "../../agents/RequirementUnderstanding";
import { ProjectIntakeService } from "../../agents/ProjectIntake";
import { BossPlanningService } from "../../agents/BossPlanning";
import { TaskDispatcher } from "../TaskDispatcher";
import { PlanExecutionService } from "./index";
import type { ExecutionPlan } from "../../agents/BossPlanning";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const manager = createManager(
  "manager-001",
  "Manager",
  boss.id
);

registry.register(boss);
registry.register(manager);

const requirement = new RequirementUnderstandingService().create({
  id: "requirement-001",
  clientId: "client-001",
  input:
    "Objective: Build a portal.\nRequirements:\n- Users can view projects.\n- Users can submit updates.\nConstraints:\n- Must use TypeScript.\nDeliverables:\n- Deployed portal.\nAcceptance Criteria:\n- Users can view and submit project updates.",
  createdAt: "2026-09-11T00:00:00.000Z",
});
const project = new ProjectIntakeService(registry).intake(
  "project-001",
  boss.id,
  requirement,
  "2026-09-11T01:00:00.000Z"
).project;

if (!project) {
  throw new Error("Expected project fixture");
}

const plan = new BossPlanningService(registry).plan(
  "plan-001",
  project,
  requirement,
  boss.id,
  "2026-09-11T02:00:00.000Z"
).plan;

if (!plan) {
  throw new Error("Expected execution plan fixture");
}

const dispatcher = new TaskDispatcher(registry);
const execution = new PlanExecutionService(
  registry,
  dispatcher
);
const created = execution.execute(plan);

if (
  created.decision !== "EXECUTED" ||
  created.tasks.length !== plan.tasks.length ||
  created.tasks.some((task) => task.status !== "queued")
) {
  throw new Error("Expected plan to create queued Tasks");
}

if (
  created.tasks[0].id !== plan.tasks[0].id ||
  created.tasks[0].title !== plan.tasks[0].title ||
  created.tasks[0].description !== plan.tasks[0].description ||
  created.tasks[0].priority !== plan.tasks[0].priority ||
  created.tasks[0].budget !== plan.tasks[0].budget
) {
  throw new Error("Expected planned task fields to be preserved");
}

if (
  JSON.stringify(created.tasks[2].dependencies) !==
  JSON.stringify(plan.tasks[2].dependencies)
) {
  throw new Error("Expected planned dependencies to be preserved");
}

if (execution.get(plan.id)?.length !== plan.tasks.length) {
  throw new Error("Expected executed plan retrieval");
}

if (execution.getAll().size !== 1) {
  throw new Error("Expected all executed plans retrieval");
}

if (execution.execute(plan).decision !== "REJECTED") {
  throw new Error("Expected duplicate plan execution to be rejected");
}

const deterministicDispatcher = new TaskDispatcher(registry);
const deterministic = new PlanExecutionService(
  registry,
  deterministicDispatcher
).execute(plan);

if (
  JSON.stringify(
    deterministic.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      budget: task.budget,
      dependencies: task.dependencies,
      status: task.status,
      assignedTo: task.assignedTo,
      createdBy: task.createdBy,
    }))
  ) !==
  JSON.stringify(
    created.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      budget: task.budget,
      dependencies: task.dependencies,
      status: task.status,
      assignedTo: task.assignedTo,
      createdBy: task.createdBy,
    }))
  )
) {
  throw new Error("Expected deterministic Task conversion");
}

const rejectedPlans: ExecutionPlan[] = [
  { ...plan, id: "", tasks: [plan.tasks[0]] },
  { ...plan, id: "empty", tasks: [] },
  { ...plan, id: "non-boss", plannedBy: manager.id },
  {
    ...plan,
    id: "duplicate-task",
    tasks: [plan.tasks[0], { ...plan.tasks[0] }],
  },
  {
    ...plan,
    id: "missing-dependency",
    tasks: [{ ...plan.tasks[0], dependencies: ["missing"] }],
  },
  {
    ...plan,
    id: "empty-task-id",
    tasks: [{ ...plan.tasks[0], id: "" }],
  },
  {
    ...plan,
    id: "empty-task-title",
    tasks: [{ ...plan.tasks[0], title: "" }],
  },
];

for (const invalidPlan of rejectedPlans) {
  if (execution.execute(invalidPlan).decision !== "REJECTED") {
    throw new Error("Expected invalid plan to be rejected");
  }
}

console.log("Plan execution tests passed.");