import { AgentRegistry } from "../AgentRegistry";
import { createBoss } from "../Boss";
import { createManager } from "../Managers";
import {
  RequirementUnderstandingService,
} from "../RequirementUnderstanding";
import { ProjectIntakeService } from "../ProjectIntake";
import { BossPlanningService } from "./index";

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
    "Objective: Build a client portal.\nRequirements:\n- Users can view projects.\n- Users can submit updates.\nConstraints:\n- Must use TypeScript.\nDeliverables:\n- Deployed portal.\nAcceptance Criteria:\n- Users can view and submit project updates.",
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

const planning = new BossPlanningService(registry);
const createdAt = "2026-09-11T02:00:00.000Z";
const created = planning.plan(
  "plan-001",
  project,
  requirement,
  boss.id,
  createdAt
);

if (
  created.decision !== "CREATED" ||
  !created.plan ||
  created.plan.projectId !== project.id ||
  created.plan.plannedBy !== boss.id
) {
  throw new Error("Expected Boss to create an execution plan");
}

if (
  created.plan.tasks.length !== 3 ||
  created.plan.tasks[0].title !==
    "Implement requirement: Users can view projects" ||
  created.plan.tasks[2].title !== "Deliver: Deployed portal"
) {
  throw new Error("Expected requirements and deliverables to become tasks");
}

if (
  created.plan.tasks.some(
    (task) => task.priority !== requirement.priority || task.budget !== 0
  )
) {
  throw new Error("Expected requirement priority and neutral budget");
}

if (
  JSON.stringify(created.plan.tasks[2].dependencies) !==
  JSON.stringify([
    "plan-001-requirement-1",
    "plan-001-requirement-2",
  ])
) {
  throw new Error("Expected deterministic deliverable dependencies");
}

if (planning.get("plan-001")?.id !== "plan-001") {
  throw new Error("Expected plan retrieval");
}

if (planning.getAll().length !== 1) {
  throw new Error("Expected all plans retrieval");
}

const deterministic = new BossPlanningService(registry).plan(
  "plan-001",
  project,
  requirement,
  boss.id,
  createdAt
);

if (JSON.stringify(created.plan) !== JSON.stringify(deterministic.plan)) {
  throw new Error("Expected deterministic plan creation");
}

if (
  planning.plan(
    "plan-non-boss",
    project,
    requirement,
    manager.id,
    createdAt
  ).decision !== "REJECTED"
) {
  throw new Error("Expected non-Boss planner rejection");
}

if (
  planning.plan(
    "plan-unknown",
    project,
    requirement,
    "unknown-agent",
    createdAt
  ).decision !== "REJECTED"
) {
  throw new Error("Expected unknown planner rejection");
}

const clarification = new RequirementUnderstandingService().create({
  id: "requirement-clarification",
  clientId: "client-001",
  input: "Build a portal.",
  createdAt: "2026-09-11T00:00:00.000Z",
});

if (
  planning.plan(
    "plan-clarification",
    project,
    clarification,
    boss.id,
    createdAt
  ).decision !== "REJECTED"
) {
  throw new Error("Expected clarification requirement rejection");
}

try {
  planning.plan(
    "plan-001",
    project,
    requirement,
    boss.id,
    createdAt
  );
  throw new Error("Expected duplicate plan ID to be rejected");
} catch (error) {
  if (
    !(error instanceof Error) ||
    !error.message.includes("already exists")
  ) {
    throw error;
  }
}

if (
  planning.plan(
    "",
    project,
    requirement,
    boss.id,
    createdAt
  ).decision !== "REJECTED"
) {
  throw new Error("Expected empty plan ID rejection");
}

console.log("Boss planning tests passed.");