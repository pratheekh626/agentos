import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createWorker } from "../../agents/Workers";
import { EvidenceService } from "../../verification/Evidence";
import { VerificationService } from "../../verification/Verification";
import { ExecutionService } from "../../agents/Execution";
import type { ExecutionRecord } from "../../agents/Execution";
import type { Task } from "../../core/Task";
import { ProjectVerificationService } from "./index";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const worker = createWorker("worker-001", "Worker", boss.id);

registry.register(boss);
registry.register(worker);

const evidenceService = new EvidenceService();
const verificationService = new VerificationService();
const executionService = new ExecutionService(evidenceService);
const bridge = new ProjectVerificationService(
  registry,
  evidenceService,
  verificationService
);

let passedEvent = false;
let failedEvent = false;

verificationService.events.on("verification.passed", (check) => {
  passedEvent = check.verifiedBy === boss.id;
});
verificationService.events.on("verification.failed", (check) => {
  failedEvent = check.verifiedBy === boss.id;
});

const task: Task = {
  id: "task-verify",
  title: "Build portal",
  description: "Build the portal.",
  assignedTo: worker.id,
  createdBy: boss.id,
  status: "in_progress",
  priority: "high",
  dependencies: [],
  budget: 0,
  spent: 0,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
};

executionService.start(task, worker);
const completedExecution = executionService.execute(
  task,
  worker,
  {
    success: true,
    output: "Portal built.",
    evidence: {
      type: "test_result",
      title: "Portal result",
      description: "Portal tests passed.",
      reference: "test-run-portal",
    },
  }
);

const requested = bridge.request(
  completedExecution,
  boss,
  "verification-001"
);

if (
  requested.decision !== "CREATED" ||
  requested.verification?.evidenceIds[0] !== completedExecution.evidenceId
) {
  throw new Error("Expected verification request with execution evidence");
}

const passed = bridge.pass(
  "verification-001",
  boss,
  96,
  "Evidence and checks passed."
);

if (
  passed.decision !== "PASSED" ||
  passed.verification?.verifiedBy !== boss.id ||
  !passedEvent
) {
  throw new Error("Expected independent verification pass");
}

const failedTask: Task = {
  ...task,
  id: "task-failed-verification",
};
executionService.start(failedTask, worker);
const failedExecution = executionService.execute(
  failedTask,
  worker,
  {
    success: true,
    output: "Work completed but validation failed.",
    evidence: {
      type: "log",
      title: "Validation log",
      description: "Validation requires review.",
      reference: "log-validation",
    },
  }
);

bridge.request(
  failedExecution,
  boss,
  "verification-002"
);
const failed = bridge.fail(
  "verification-002",
  boss,
  30,
  "Required validation failed."
);

if (
  failed.decision !== "FAILED" ||
  failed.verification?.verifiedBy !== boss.id ||
  !failedEvent
) {
  throw new Error("Expected independent verification failure");
}

if (
  bridge.request(
    completedExecution,
    worker,
    "verification-worker"
  ).decision !== "REJECTED"
) {
  throw new Error("Expected worker self-verification rejection");
}

const unregisteredVerifier = {
  ...boss,
  id: "boss-missing",
};

if (
  bridge.request(
    completedExecution,
    unregisteredVerifier,
    "verification-unregistered"
  ).decision !== "REJECTED"
) {
  throw new Error("Expected unregistered verifier rejection");
}

const incompleteExecution: ExecutionRecord = {
  ...completedExecution,
  taskId: "task-incomplete",
  status: "started",
};

if (
  bridge.request(
    incompleteExecution,
    boss,
    "verification-incomplete"
  ).decision !== "REJECTED"
) {
  throw new Error("Expected incomplete execution rejection");
}

const missingEvidence: ExecutionRecord = {
  ...completedExecution,
  taskId: "task-missing-evidence",
  evidenceId: null,
};

if (
  bridge.request(
    missingEvidence,
    boss,
    "verification-missing-evidence"
  ).decision !== "REJECTED"
) {
  throw new Error("Expected missing evidence rejection");
}

const unrelatedEvidence: ExecutionRecord = {
  ...completedExecution,
  taskId: "task-unrelated",
};

if (
  bridge.request(
    unrelatedEvidence,
    boss,
    "verification-unrelated-evidence"
  ).decision !== "REJECTED"
) {
  throw new Error("Expected unrelated evidence rejection");
}

if (
  bridge.request(
    completedExecution,
    boss,
    "verification-001"
  ).decision !== "REJECTED"
) {
  throw new Error("Expected duplicate verification rejection");
}

console.log("Project verification tests passed.");