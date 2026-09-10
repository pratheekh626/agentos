import { AuditLedger } from "../AuditLedger";
import { AuditEventBridge } from "./index";
import { EventBus } from "../../messaging/EventBus";
import type { ExecutionEvents } from "../../agents/Execution";
import type { VerificationEvents } from "../../verification/Verification";
import type { QAEvents } from "../../verification/QA";
import type { ProofToPayEvents } from "../../verification/ProofToPay";
import type { RecoveryEvents } from "../../orchestration/Recovery";
import type { EscalationEvents } from "../../orchestration/Escalation";
import type { InterventionEvents } from "../../orchestration/Intervention";

const ledger = new AuditLedger();
const executionBus = new EventBus<ExecutionEvents>();
const verificationBus = new EventBus<VerificationEvents>();
const qaBus = new EventBus<QAEvents>();
const paymentBus = new EventBus<ProofToPayEvents>();
const recoveryBus = new EventBus<RecoveryEvents>();
const escalationBus = new EventBus<EscalationEvents>();
const interventionBus = new EventBus<InterventionEvents>();

const bridge = new AuditEventBridge(
  ledger,
  executionBus,
  verificationBus,
  qaBus,
  paymentBus,
  recoveryBus,
  escalationBus,
  interventionBus
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

paymentBus.emit("payment.released", {
  request: {
    id: "payment-1",
    agent: {
      id: "worker-1",
      name: "Worker",
      role: "worker",
      managerId: "manager-1",
      status: "working",
      permissions: {
        canDelegate: false,
        canExecuteTools: true,
        canSpendCredits: true,
        canApproveWork: false,
      },
      trustScore: 90,
      createdAt: "2026-09-11T00:00:00.000Z",
    },
    taskId: "task-1",
    amount: 300,
    reason: "Approved work",
    riskScore: 10,
    budgetId: "budget-1",
  },
  result: {
    status: "paid",
    creditResult: {
      decision: "ALLOW",
      transaction: {
        id: "transaction-1",
        agentId: "worker-1",
        type: "debit",
        amount: 300,
        status: "completed",
        reason: "Approved work",
        taskId: "task-1",
        createdAt: "2026-09-11T00:00:07.000Z",
        completedAt: "2026-09-11T00:00:08.000Z",
      },
      reason: "Action satisfies current policy",
    },
    reason: "Proof verified and payment released",
  },
});

paymentBus.emit("payment.escalated", {
  request: {
    id: "payment-2",
    agent: {
      id: "worker-1",
      name: "Worker",
      role: "worker",
      managerId: "manager-1",
      status: "working",
      permissions: {
        canDelegate: false,
        canExecuteTools: true,
        canSpendCredits: true,
        canApproveWork: false,
      },
      trustScore: 90,
      createdAt: "2026-09-11T00:00:00.000Z",
    },
    taskId: "task-1",
    amount: 200,
    reason: "Higher-risk work",
    riskScore: 60,
    budgetId: "budget-1",
  },
  result: {
    status: "awaiting_approval",
    creditResult: {
      decision: "ESCALATE",
      transaction: {
        id: "transaction-2",
        agentId: "worker-1",
        type: "debit",
        amount: 200,
        status: "pending",
        reason: "Higher-risk work",
        taskId: "task-1",
        createdAt: "2026-09-11T00:00:09.000Z",
        completedAt: null,
      },
      reason: "Action requires human approval",
    },
    reason: "Proof verified but payment requires approval",
  },
});

recoveryBus.emit("recovery.attempted", {
  id: "recovery-1",
  taskId: "task-1",
  failedAgentId: "worker-1",
  reason: "Worker failed",
  attempt: 1,
  action: "retry",
  status: "pending",
  createdAt: "2026-09-11T00:00:10.000Z",
});

recoveryBus.emit("recovery.succeeded", {
  id: "recovery-1",
  taskId: "task-1",
  failedAgentId: "worker-1",
  reason: "Worker recovered",
  attempt: 1,
  action: "retry",
  status: "recovered",
  createdAt: "2026-09-11T00:00:10.000Z",
});

recoveryBus.emit("recovery.failed", {
  id: "recovery-2",
  taskId: "task-2",
  failedAgentId: "worker-1",
  reason: "No replacement worker",
  attempt: 2,
  action: "reassign",
  status: "failed",
  createdAt: "2026-09-11T00:00:11.000Z",
});

escalationBus.emit("escalation.created", {
  id: "escalation-1",
  managerId: "manager-1",
  bossId: "boss-1",
  taskId: "task-2",
  reason: "Recovery requires intervention",
  createdAt: "2026-09-11T00:00:12.000Z",
  approvalRequestId: "approval-escalation-1",
});

escalationBus.emit("escalation.approved", {
  id: "escalation-1",
  managerId: "manager-1",
  bossId: "boss-1",
  taskId: "task-2",
  reason: "Recovery requires intervention",
  createdAt: "2026-09-11T00:00:12.000Z",
  approvalRequestId: "approval-escalation-1",
});

escalationBus.emit("escalation.rejected", {
  id: "escalation-2",
  managerId: "manager-1",
  bossId: "boss-1",
  taskId: "task-3",
  reason: "Rejected intervention",
  createdAt: "2026-09-11T00:00:13.000Z",
  approvalRequestId: "approval-escalation-2",
});

interventionBus.emit("intervention.created", {
  id: "intervention-1",
  escalationId: "escalation-1",
  bossId: "boss-1",
  action: "send_instruction",
  instruction: "Use the approved fallback plan.",
  managerId: "manager-1",
  taskId: "task-2",
  createdAt: "2026-09-11T00:00:14.000Z",
});

const events = ledger.getAll();

if (events.length !== 13) {
  throw new Error(
    `Expected 13 audit events, got ${events.length}`
  );
}

const eventTypes = events.map((event) => event.type);

if (
  eventTypes[0] !== "EVIDENCE_SUBMITTED" ||
  eventTypes[1] !== "VERIFICATION_PASSED" ||
  eventTypes[2] !== "QA_PASSED" ||
  eventTypes[3] !== "QA_FAILED" ||
  eventTypes[4] !== "PAYMENT_RELEASED" ||
  eventTypes[5] !== "PAYMENT_ESCALATED" ||
  eventTypes[6] !== "RECOVERY_ATTEMPTED" ||
  eventTypes[7] !== "RECOVERY_SUCCEEDED" ||
  eventTypes[8] !== "RECOVERY_FAILED" ||
  eventTypes[9] !== "ESCALATION_CREATED" ||
  eventTypes[10] !== "ESCALATION_APPROVED" ||
  eventTypes[11] !== "ESCALATION_REJECTED" ||
  eventTypes[12] !== "INTERVENTION_CREATED"
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

if (events[4].actorId !== "worker-1") {
  throw new Error("Incorrect payment released actor");
}

if (events[4].targetId !== "transaction-1") {
  throw new Error("Incorrect payment released target");
}

if (events[4].taskId !== "task-1") {
  throw new Error("Incorrect payment released task");
}

if (events[4].details?.transactionStatus !== "completed") {
  throw new Error(
    "Payment released transaction was not completed"
  );
}

if (events[5].details?.transactionStatus !== "pending") {
  throw new Error(
    "Payment escalated transaction was not pending"
  );
}

if (events[6].details?.attempt !== 1) {
  throw new Error("Recovery attempt was not recorded");
}

if (events[7].type !== "RECOVERY_SUCCEEDED") {
  throw new Error("Recovery success was not audited");
}

if (events[9].actorId !== "manager-1") {
  throw new Error("Escalation creator was not recorded");
}

if (events[10].actorId !== "boss-1") {
  throw new Error("Escalation approver was not recorded");
}

if (events[12].details?.action !== "send_instruction") {
  throw new Error("Intervention action was not recorded");
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

if (ledger.getAll().length !== 13) {
  throw new Error(
    "Audit bridge did not disconnect lifecycle handlers correctly"
  );
}

console.log("AuditEventBridge tests passed");
