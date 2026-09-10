import {
  RequirementUnderstandingService,
} from "./index";

const createdAt = "2026-09-11T00:00:00.000Z";
const completeInput = `Objective: Build a client portal.
Requirements:
- Users can view projects.
- Users can submit updates.
Constraints:
- Must use TypeScript.
- Launch within 30 days.
Deliverables:
- Deployed client portal.
Acceptance Criteria:
- Users can view and submit project updates.`;

const service = new RequirementUnderstandingService();
const complete = service.create({
  id: "requirement-complete",
  clientId: "client-001",
  input: completeInput,
  createdAt,
});

if (complete.status !== "ready") {
  throw new Error("Expected complete labeled requirement to be ready");
}

if (
  complete.rawInput !== completeInput ||
  complete.requirements.length !== 2 ||
  complete.constraints.length !== 2 ||
  complete.deliverables.length !== 1 ||
  complete.acceptanceCriteria.length !== 1
) {
  throw new Error("Expected labeled sections to be parsed and preserved");
}

const naturalInput = "Build a platform for teams and partners.";
const natural = service.create({
  id: "requirement-natural",
  clientId: "client-001",
  input: `  ${naturalInput}  `,
  createdAt,
});

if (
  natural.rawInput !== `  ${naturalInput}  ` ||
  natural.requirements.length !== 1 ||
  natural.requirements[0] !== naturalInput
) {
  throw new Error("Expected natural language to remain intact");
}

const deterministic = new RequirementUnderstandingService().create({
  id: "requirement-natural",
  clientId: "client-001",
  input: `  ${naturalInput}  `,
  createdAt,
});

if (JSON.stringify(natural) !== JSON.stringify(deterministic)) {
  throw new Error("Expected deterministic structured output");
}

const missingRequirements = service.create({
  id: "missing-requirements",
  clientId: "client-001",
  input:
    "Build a portal. Constraints: use TypeScript. Deliverables: deployed portal. Acceptance Criteria: users can access the portal.",
  createdAt,
});

if (
  missingRequirements.status !== "needs_clarification" ||
  !missingRequirements.clarificationQuestions.some((question) =>
    question.includes("functional requirements")
  )
) {
  throw new Error("Expected missing requirements clarification");
}

const missingDeliverables = service.create({
  id: "missing-deliverables",
  clientId: "client-001",
  input:
    "Requirements: users can access the portal. Constraints: use TypeScript. Acceptance Criteria: users can access the portal.",
  createdAt,
});

if (
  !missingDeliverables.clarificationQuestions.some((question) =>
    question.includes("deliverables")
  )
) {
  throw new Error("Expected missing deliverables clarification");
}

const missingConstraints = service.create({
  id: "missing-constraints",
  clientId: "client-001",
  input:
    "Requirements: users can access the portal. Deliverables: deployed portal. Acceptance Criteria: users can access the portal.",
  createdAt,
});

if (
  !missingConstraints.clarificationQuestions.some((question) =>
    question.includes("constraints")
  )
) {
  throw new Error("Expected missing constraints clarification");
}

const missingAcceptance = service.create({
  id: "missing-acceptance",
  clientId: "client-001",
  input:
    "Requirements: users can access the portal. Constraints: use TypeScript. Deliverables: deployed portal.",
  createdAt,
});

if (
  !missingAcceptance.clarificationQuestions.some((question) =>
    question.includes("complete")
  )
) {
  throw new Error("Expected missing acceptance clarification");
}

for (const request of [
  {
    id: "",
    clientId: "client-001",
    input: "Build a website",
    createdAt,
  },
  {
    id: "missing-client",
    clientId: "",
    input: "Build a website",
    createdAt,
  },
  {
    id: "missing-input",
    clientId: "client-001",
    input: "",
    createdAt,
  },
]) {
  try {
    service.create(request);
    throw new Error("Expected invalid requirement to be rejected");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("required")) {
      throw error;
    }
  }
}

try {
  service.create({
    id: complete.id,
    clientId: "client-001",
    input: "Duplicate request",
    createdAt,
  });
  throw new Error("Expected duplicate requirement to be rejected");
} catch (error) {
  if (
    !(error instanceof Error) ||
    !error.message.includes("already exists")
  ) {
    throw error;
  }
}

if (service.get(complete.id)?.id !== complete.id) {
  throw new Error("Expected requirement retrieval");
}

if (service.getAll().length !== 6) {
  throw new Error("Expected all requirements retrieval");
}

console.log("Requirement understanding tests passed.");
