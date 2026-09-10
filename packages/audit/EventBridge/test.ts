import { AuditLedger } from "../AuditLedger";
import { AuditEventBridge } from "./index";
import { EventBus } from "../../messaging/EventBus";
import type { ExecutionEvents } from "../../agents/Execution";
import type { VerificationEvents } from "../../verification/Verification";
import type { QAEvents } from "../../verification/QA";

const ledger = new AuditLedger();
const executionBus = new EventBus<ExecutionEvents>();
const verificationBus = new EventBus<VerificationEvents>();
const qaBus = new EventBus<QAEvents>();

const bridge = new AuditEventBridge(
  ledger,
  executionBus,
  verificationBus,
  qaBus
);

executionBus.emit("execution.evidence_created", {
  id: "evidence-1",
  taskId: "task-1",
  agentId: "worker-1",
  type: "test_result",
  title: "Build tests",
  description: "All tests passed",
  reference: "test://result-1",
  createdAt: "2026-09-11T00:00:00.000Z",
});

verificationBus.emit("verification.passed", {
  id: "verification-1",
  taskId: "task-1",
  evidenceIds: ["evidence-1"],
  status: "passed",
  score: 95,
  reason: "All required checks passed",
  verifiedBy: "tester-1",
  createdAt: "2026-09-11T00:00:01.000Z",
  completedAt: "2026-09-11T00:00:02.000Z",
});

qaBus.emit("qa.passed", {
  id: "qa-1",
  taskId: "task-1",
  checks: ["Unit tests", "Security checks"],
  status: "passed",
  score: 98,
  issues: [],
  checkedBy: "qa-1",
  createdAt: "2026-09-11T00:00:03.000Z",
  completedAt: "2026-09-11T00:00:04.000Z",
});

qaBus.emit("qa.failed", {
  id: "qa-2",
  taskId: "task-2",
  checks: ["Integration tests"],
  status: "failed",
  score: 20,
  issues: ["Integration check failed"],
  checkedBy: "qa-1",
  createdAt: "2026-09-11T00:00:05.000Z",
  completedAt: "2026-09-11T00:00:06.000Z",
});

const events = ledger.getAll();

if (events.length !== 4) {
  throw new Error(
    `Expected 4 audit events, got ${events.length}`
  );
}

const eventTypes = events.map((event) => event.type);

if (
  eventTypes[0] !== "EVIDENCE_SUBMITTED" ||
  eventTypes[1] !== "VERIFICATION_PASSED" ||
  eventTypes[2] !== "QA_PASSED" ||
  eventTypes[3] !== "QA_FAILED"
) {
  throw new Error("Expected complete evidence-to-QA audit chain");
}

if (events[2].actorId !== "qa-1") {
  throw new Error("Incorrect QA passed actor");
}

if (events[2].targetId !== "qa-1") {
  throw new Error("Incorrect QA passed target");
}

if (events[2].taskId !== "task-1") {
  throw new Error("Incorrect QA passed task");
}

if (events[2].details?.score !== 98) {
  throw new Error("QA passed score was not recorded");
}

if (events[3].details?.score !== 20) {
  throw new Error("QA failed score was not recorded");
}

if (
  !Array.isArray(events[3].details?.issues) ||
  events[3].details.issues[0] !== "Integration check failed"
) {
  throw new Error("QA failed issues were not recorded");
}

if (!ledger.verifyIntegrity()) {
  throw new Error("Audit ledger integrity check failed");
}

bridge.disconnect();

qaBus.emit("qa.passed", {
  id: "qa-after-disconnect",
  taskId: "task-3",
  checks: ["Should not be audited"],
  status: "passed",
  score: 100,
  issues: [],
  checkedBy: "qa-1",
  createdAt: "2026-09-11T00:01:00.000Z",
  completedAt: "2026-09-11T00:01:01.000Z",
});

if (ledger.getAll().length !== 4) {
  throw new Error(
    "Audit bridge did not disconnect QA handlers correctly"
  );
}

console.log("AuditEventBridge tests passed");
