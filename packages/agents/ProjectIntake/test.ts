import { AgentRegistry } from "../AgentRegistry";
import { createBoss } from "../Boss";
import { createManager } from "../Managers";
import {
  RequirementUnderstandingService,
} from "../RequirementUnderstanding";
import { ProjectIntakeService } from "./index";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const manager = createManager(
  "manager-001",
  "Manager",
  boss.id
);

registry.register(boss);
registry.register(manager);

const requirementService =
  new RequirementUnderstandingService();
const readyRequirement = requirementService.create({
  id: "requirement-001",
  clientId: "client-001",
  input:
    "Objective: Build a client portal.\nRequirements:\n- Users can view projects.\nConstraints:\n- Must use TypeScript.\nDeliverables:\n- Deployed portal.\nAcceptance Criteria:\n- Users can view projects.",
  createdAt: "2026-09-11T00:00:00.000Z",
});

const intake = new ProjectIntakeService(registry);
const createdAt = "2026-09-11T01:00:00.000Z";
const accepted = intake.intake(
  "project-001",
  boss.id,
  readyRequirement,
  createdAt
);

if (
  accepted.decision !== "ACCEPTED" ||
  !accepted.project ||
  accepted.project.requirementId !== readyRequirement.id ||
  accepted.project.clientId !== readyRequirement.clientId ||
  accepted.project.objective !== readyRequirement.objective ||
  accepted.project.status !== "planned"
) {
  throw new Error("Expected Boss to accept a planned project");
}

if (intake.get("project-001")?.id !== "project-001") {
  throw new Error("Expected project retrieval");
}

if (intake.getAll().length !== 1) {
  throw new Error("Expected all projects retrieval");
}

const deterministicIntake = new ProjectIntakeService(registry);
const deterministic = deterministicIntake.intake(
  "project-001",
  boss.id,
  readyRequirement,
  createdAt
);

if (JSON.stringify(accepted.project) !== JSON.stringify(deterministic.project)) {
  throw new Error("Expected deterministic project creation");
}

const needsClarification = requirementService.create({
  id: "requirement-002",
  clientId: "client-001",
  input: "Build a portal.",
  createdAt: "2026-09-11T00:00:00.000Z",
});

const clarificationResult = intake.intake(
  "project-002",
  boss.id,
  needsClarification,
  createdAt
);

if (
  clarificationResult.decision !== "NEEDS_CLARIFICATION" ||
  clarificationResult.project !== null ||
  intake.get("project-002")
) {
  throw new Error("Expected clarification to create no project");
}

if (
  intake.intake(
    "project-003",
    manager.id,
    readyRequirement,
    createdAt
  ).decision !== "REJECTED"
) {
  throw new Error("Expected non-Boss caller to be rejected");
}

if (
  intake.intake(
    "project-004",
    "unknown-agent",
    readyRequirement,
    createdAt
  ).decision !== "REJECTED"
) {
  throw new Error("Expected unknown caller to be rejected");
}

try {
  intake.intake(
    "project-001",
    boss.id,
    readyRequirement,
    createdAt
  );
  throw new Error("Expected duplicate project ID to be rejected");
} catch (error) {
  if (
    !(error instanceof Error) ||
    !error.message.includes("already exists")
  ) {
    throw error;
  }
}

if (
  intake.intake(
    "",
    boss.id,
    readyRequirement,
    createdAt
  ).decision !== "REJECTED"
) {
  throw new Error("Expected empty project ID to be rejected");
}

console.log("Project intake tests passed.");