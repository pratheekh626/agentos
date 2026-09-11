import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createWorker } from "../../agents/Workers";
import { EvidenceService } from "../../verification/Evidence";
import { VerificationService } from "../../verification/Verification";
import { QAService } from "../../verification/QA";
import { ProjectQAService } from "./index";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const worker = createWorker("worker-001", "Worker", boss.id);
const qaAgent = createBoss("qa-001", "QA Agent");
const noCapability = createWorker(
  "worker-qa",
  "Worker QA",
  boss.id
);

registry.register(boss);
registry.register(worker);
registry.register(qaAgent);
registry.register(noCapability);

const evidence = new EvidenceService();
const verification = new VerificationService();
const qa = new QAService();
const bridge = new ProjectQAService(
  registry,
  evidence,
  qa
);

let passedEvent = false;
let failedEvent = false;
qa.events.on("qa.passed", (check) => {
  passedEvent = check.checkedBy === qaAgent.id;
});
qa.events.on("qa.failed", (check) => {
  failedEvent = check.checkedBy === qaAgent.id;
});

const evidenceItem = evidence.create(
  "evidence-qa",
  "task-qa",
  worker.id,
  "test_result",
  "Worker result",
  "Worker output is ready for QA.",
  "qa-test-run"
);
const passedVerification = verification.create(
  "verification-qa",
  "task-qa",
  [evidenceItem]
);
verification.pass(
  passedVerification.id,
  95,
  "Verification passed",
  boss.id
);
const resolvedVerification = verification.get(
  passedVerification.id
)!;

const requested = bridge.request(
  resolvedVerification,
  qaAgent,
  "qa-001",
  ["Unit tests", "Security checks"]
);

if (
  requested.decision !== "CREATED" ||
  requested.qa?.status !== "pending" ||
  requested.qa?.taskId !== resolvedVerification.taskId
) {
  throw new Error("Expected pending QA for passed verification");
}

const passed = bridge.pass("qa-001", qaAgent, 98);

if (
  passed.decision !== "PASSED" ||
  passed.qa?.checkedBy !== qaAgent.id ||
  !passedEvent
) {
  throw new Error("Expected QA pass through QAService");
}

const failedEvidence = evidence.create(
  "evidence-qa-failed",
  "task-qa-failed",
  worker.id,
  "log",
  "Worker result",
  "Worker output requires QA review.",
  "qa-failed-run"
);
const failedVerification = verification.create(
  "verification-qa-failed",
  "task-qa-failed",
  [failedEvidence]
);
verification.pass(
  failedVerification.id,
  90,
  "Verification passed",
  boss.id
);

const failedRequest = bridge.request(
  verification.get(failedVerification.id)!,
  qaAgent,
  "qa-002",
  ["Integration checks"]
);
const failed = bridge.fail(
  "qa-002",
  qaAgent,
  25,
  ["Integration checks failed"]
);

if (
  failedRequest.decision !== "CREATED" ||
  failed.decision !== "FAILED" ||
  failed.qa?.checkedBy !== qaAgent.id ||
  !failedEvent
) {
  throw new Error("Expected QA failure through QAService");
}

const failedVerificationCheck = verification.create(
  "verification-failed",
  "task-verification-failed",
  [
    evidence.create(
      "evidence-verification-failed",
      "task-verification-failed",
      worker.id,
      "log",
      "Failed verification evidence",
      "Verification did not pass.",
      "verification-failed-run"
    ),
  ]
);
verification.fail(
  failedVerificationCheck.id,
  20,
  "Verification failed",
  boss.id
);

if (
  bridge.request(
    verification.get(failedVerificationCheck.id)!,
    qaAgent,
    "qa-verification-failed",
    ["Should not run"]
  ).decision !== "REJECTED"
) {
  throw new Error("Expected failed verification rejection");
}

if (
  bridge.request(
    resolvedVerification,
    worker,
    "qa-worker",
    ["Should not run"]
  ).decision !== "REJECTED"
) {
  throw new Error("Expected worker self-QA rejection");
}

if (
  bridge.request(
    resolvedVerification,
    noCapability,
    "qa-no-capability",
    ["Should not run"]
  ).decision !== "REJECTED"
) {
  throw new Error("Expected QA capability rejection");
}

const unknownAgent = { ...qaAgent, id: "qa-unknown" };
if (
  bridge.request(
    resolvedVerification,
    unknownAgent,
    "qa-unknown",
    ["Should not run"]
  ).decision !== "REJECTED"
) {
  throw new Error("Expected unregistered QA rejection");
}

if (
  bridge.request(
    resolvedVerification,
    qaAgent,
    "qa-001",
    ["Duplicate"]
  ).decision !== "REJECTED"
) {
  throw new Error("Expected duplicate QA rejection");
}

console.log("Project QA tests passed.");