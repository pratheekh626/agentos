import { AgentRegistry } from "../../agents/AgentRegistry";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";
import { PermissionEngine } from "../../governance/PermissionEngine";
import { PolicyEngine } from "../../governance/PolicyEngine";
import { WalletService } from "../../economy/Wallet";
import { BudgetService } from "../../economy/Budget";
import { TransactionService } from "../../economy/Transactions";
import { CreditEngine } from "../../economy/CreditEngine";
import { IdentityService } from "../../security/Identity";
import { AccessControlService } from "../../security/AccessControl";
import { RiskEngine } from "../../security/RiskEngine";
import { AnomalyDetectionService } from "../../security/AnomalyDetection";
import { KillSwitchService } from "../../security/KillSwitch";
import { SecurityGateway } from "../../security/SecurityGateway";
import { EvidenceService } from "../../verification/Evidence";
import { VerificationService } from "../../verification/Verification";
import { QAService } from "../../verification/QA";
import { ProofToPayService } from "../../verification/ProofToPay";
import { ProjectProofToPayService } from "./index";
import type { ExecutionRecord } from "../../agents/Execution";
import type { QACheck } from "../../verification/QA";
import type { VerificationCheck } from "../../verification/Verification";

const registry = new AgentRegistry();
const manager = createManager("manager-001", "Manager", "boss-001");
const worker = createWorker("worker-001", "Worker", manager.id);
registry.register(manager);
registry.register(worker);

const identity = new IdentityService();
identity.createIdentity({ agentId: worker.id, role: worker.role });
const wallet = new WalletService();
wallet.createWallet(worker.id, 1250, 2000, 500);
const budget = new BudgetService();
budget.createBudget("budget-001", worker.id, 1000, 600);
const evidence = new EvidenceService();
const verification = new VerificationService();
const qa = new QAService();
const security = new SecurityGateway(
  identity,
  new AccessControlService(identity),
  new RiskEngine(),
  new AnomalyDetectionService(),
  new KillSwitchService(identity, wallet)
);
const proofToPay = new ProofToPayService(
  evidence,
  verification,
  qa,
  new CreditEngine(
    new PermissionEngine(),
    new PolicyEngine(),
    wallet,
    budget,
    new TransactionService(),
    security
  )
);

const bridge = new ProjectProofToPayService(evidence, proofToPay);

const taskId = "task-payment-001";
const evidenceItem = evidence.create(
  "evidence-payment-001",
  taskId,
  worker.id,
  "test_result",
  "Worker result",
  "Work completed.",
  "test-run-payment"
);
const verificationItem = verification.create(
  "verification-payment-001",
  taskId,
  [evidenceItem]
);
verification.pass(
  verificationItem.id,
  95,
  "Verified",
  manager.id
);
const qaItem = qa.create(
  "qa-payment-001",
  taskId,
  ["Unit tests"]
);
qa.pass(qaItem.id, 98, manager.id);

const execution: ExecutionRecord = {
  taskId,
  agentId: worker.id,
  status: "completed",
  output: "Completed",
  evidenceId: evidenceItem.id,
  startedAt: "2026-09-11T00:00:00.000Z",
  completedAt: "2026-09-11T00:01:00.000Z",
};
const passedVerification = verification.get(verificationItem.id)!;
const passedQA = qa.get(qaItem.id)!;
let released = false;
let escalated = false;
proofToPay.events.on("payment.released", () => {
  released = true;
});
proofToPay.events.on("payment.escalated", () => {
  escalated = true;
});

const paid = bridge.pay(
  execution,
  passedVerification,
  passedQA,
  {
    id: "payment-project-001",
    agent: worker,
    taskId,
    amount: 300,
    reason: "Approved work",
    riskScore: 10,
    budgetId: "budget-001",
  }
);

if (paid.decision !== "PAID" || !released) {
  throw new Error("Expected QA-passed work to reach payment release");
}

const escalatedPayment = bridge.pay(
  execution,
  passedVerification,
  passedQA,
  {
    id: "payment-project-002",
    agent: worker,
    taskId,
    amount: 100,
    reason: "Higher-risk work",
    riskScore: 60,
    budgetId: "budget-001",
  }
);

if (escalatedPayment.decision !== "ESCALATED" || !escalated) {
  throw new Error("Expected high-risk payment escalation");
}

const deniedPayment = bridge.pay(
  execution,
  passedVerification,
  passedQA,
  {
    id: "payment-project-003",
    agent: worker,
    taskId,
    amount: 100,
    reason: "Denied work",
    riskScore: 90,
    budgetId: "budget-001",
  }
);

if (deniedPayment.decision !== "DENIED") {
  throw new Error("Expected CreditEngine denial to be preserved");
}

const failedQA: QACheck = {
  ...passedQA,
  id: "qa-failed",
  status: "failed",
};
if (
  bridge.pay(execution, passedVerification, failedQA, {
    id: "payment-project-004",
    agent: worker,
    taskId,
    amount: 100,
    reason: "Failed QA",
    riskScore: 10,
    budgetId: "budget-001",
  }).decision !== "REJECTED"
) {
  throw new Error("Expected failed QA rejection");
}

const failedVerification: VerificationCheck = {
  ...passedVerification,
  id: "verification-failed",
  status: "failed",
};
if (
  bridge.pay(execution, failedVerification, passedQA, {
    id: "payment-project-005",
    agent: worker,
    taskId,
    amount: 100,
    reason: "Failed verification",
    riskScore: 10,
    budgetId: "budget-001",
  }).decision !== "REJECTED"
) {
  throw new Error("Expected failed verification rejection");
}

if (
  bridge.pay(execution, passedVerification, passedQA, {
    id: "payment-project-006",
    agent: manager,
    taskId,
    amount: 100,
    reason: "Wrong requester",
    riskScore: 10,
    budgetId: "budget-001",
  }).decision !== "REJECTED"
) {
  throw new Error("Expected requester identity rejection");
}

if (
  bridge.pay(execution, passedVerification, passedQA, {
    id: "payment-project-001",
    agent: worker,
    taskId,
    amount: 100,
    reason: "Duplicate",
    riskScore: 10,
    budgetId: "budget-001",
  }).decision !== "REJECTED"
) {
  throw new Error("Expected duplicate payment request rejection");
}

console.log("Project Proof-to-Pay tests passed.");