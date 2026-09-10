import { AuditLedger } from "../AuditLedger";
import { AuditEventBridge } from "./index";
import { EventBus } from "../../messaging/EventBus";
import type { ExecutionEvents } from "../../agents/Execution";
import type { VerificationEvents } from "../../verification/Verification";

const ledger = new AuditLedger();

const executionBus =
  new EventBus<ExecutionEvents>();

const verificationBus =
  new EventBus<VerificationEvents>();

const bridge = new AuditEventBridge(
  ledger,
  executionBus,
  verificationBus
);

executionBus.emit(
  "execution.evidence_created",
  {
    id: "evidence-1",
    taskId: "task-1",
    agentId: "worker-1",
    type: "test_result",
    title: "Build tests",
    description: "All tests passed",
    reference: "test://result-1",
    createdAt:
      "2026-09-11T00:00:00.000Z",
  }
);

verificationBus.emit(
  "verification.passed",
  {
    id: "verification-1",
    taskId: "task-1",
    evidenceIds: ["evidence-1"],
    status: "passed",
    score: 95,
    reason: "All required checks passed",
    verifiedBy: "tester-1",
    createdAt:
      "2026-09-11T00:00:01.000Z",
    completedAt:
      "2026-09-11T00:00:02.000Z",
  }
);

verificationBus.emit(
  "verification.failed",
  {
    id: "verification-2",
    taskId: "task-2",
    evidenceIds: ["evidence-2"],
    status: "failed",
    score: 20,
    reason: "Required checks failed",
    verifiedBy: "tester-1",
    createdAt:
      "2026-09-11T00:00:03.000Z",
    completedAt:
      "2026-09-11T00:00:04.000Z",
  }
);

const events = ledger.getAll();

if (events.length !== 3) {
  throw new Error(
    `Expected 3 audit events, got ${events.length}`
  );
}

if (events[0].type !== "EVIDENCE_SUBMITTED") {
  throw new Error("Expected evidence audit event");
}

if (events[1].type !== "VERIFICATION_PASSED") {
  throw new Error(
    "Expected verification passed audit event"
  );
}

if (events[2].type !== "VERIFICATION_FAILED") {
  throw new Error(
    "Expected verification failed audit event"
  );
}

if (events[1].actorId !== "tester-1") {
  throw new Error(
    "Incorrect verification passed actor"
  );
}

if (events[1].targetId !== "verification-1") {
  throw new Error(
    "Incorrect verification passed target"
  );
}

if (events[1].taskId !== "task-1") {
  throw new Error(
    "Incorrect verification passed task"
  );
}

if (events[1].details?.score !== 95) {
  throw new Error(
    "Verification score was not recorded"
  );
}

if (events[2].details?.score !== 20) {
  throw new Error(
    "Failed verification score was not recorded"
  );
}

if (!ledger.verifyIntegrity()) {
  throw new Error(
    "Audit ledger integrity check failed"
  );
}

bridge.disconnect();

verificationBus.emit(
  "verification.passed",
  {
    id: "verification-after-disconnect",
    taskId: "task-3",
    evidenceIds: ["evidence-3"],
    status: "passed",
    score: 100,
    reason: "Should not be audited",
    verifiedBy: "tester-1",
    createdAt:
      "2026-09-11T00:05:00.000Z",
    completedAt:
      "2026-09-11T00:05:01.000Z",
  }
);

if (ledger.getAll().length !== 3) {
  throw new Error(
    "Audit bridge did not disconnect verification handlers correctly"
  );
}

console.log("AuditEventBridge tests passed");
