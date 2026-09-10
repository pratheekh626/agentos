import { EvidenceService } from "./index";

const evidence = new EvidenceService();

const created = evidence.create(
  "evidence-001",
  "task-production",
  "worker-001",
  "test_result",
  "Frontend test results",
  "All frontend tests passed successfully.",
  "test-run-2026-001"
);

console.log("CREATED EVIDENCE:");
console.log(created);

if (
  created.id !== "evidence-001" ||
  created.taskId !== "task-production" ||
  created.agentId !== "worker-001"
) {
  throw new Error("Evidence creation failed");
}

const second = evidence.create(
  "evidence-002",
  "task-production",
  "worker-001",
  "url",
  "Deployed application",
  "Production deployment reference.",
  "https://example.com"
);

const taskEvidence =
  evidence.getByTask("task-production");

console.log("\nTASK EVIDENCE:");
console.log(taskEvidence);

if (taskEvidence.length !== 2) {
  throw new Error("Task evidence lookup failed");
}

const agentEvidence =
  evidence.getByAgent("worker-001");

if (agentEvidence.length !== 2) {
  throw new Error("Agent evidence lookup failed");
}

try {
  evidence.create(
    "evidence-001",
    "task-production",
    "worker-001",
    "log",
    "Duplicate evidence",
    "Should fail.",
    "duplicate"
  );

  throw new Error(
    "Expected duplicate evidence creation to fail"
  );
} catch (error) {
  console.log(
    "\nDUPLICATE CHECK:",
    error instanceof Error
      ? error.message
      : error
  );
}

console.log("\nEvidence tests passed.");
