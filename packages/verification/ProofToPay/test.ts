import { AgentRegistry } from "../../agents/AgentRegistry";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";

import {
  PermissionEngine,
} from "../../governance/PermissionEngine";

import {
  PolicyEngine,
} from "../../governance/PolicyEngine";

import {
  WalletService,
} from "../../economy/Wallet";

import {
  BudgetService,
} from "../../economy/Budget";

import {
  TransactionService,
} from "../../economy/Transactions";

import {
  CreditEngine,
} from "../../economy/CreditEngine";

import {
  EvidenceService,
} from "../Evidence";

import {
  VerificationService,
} from "../Verification";

import {
  QAService,
} from "../QA";

import {
  ProofToPayService,
} from "./index";

const registry = new AgentRegistry();

const manager = createManager(
  "manager-001",
  "Engineering Manager",
  "boss-001"
);

const worker = createWorker(
  "worker-001",
  "Frontend Developer",
  manager.id
);

registry.register(manager);
registry.register(worker);

const evidenceService =
  new EvidenceService();

const verificationService =
  new VerificationService();

const qaService =
  new QAService();

const walletService =
  new WalletService();

const budgetService =
  new BudgetService();

const transactionService =
  new TransactionService();

const permissionEngine =
  new PermissionEngine();

const policyEngine =
  new PolicyEngine();

const creditEngine =
  new CreditEngine(
    permissionEngine,
    policyEngine,
    walletService,
    budgetService,
    transactionService
  );

const proofToPay =
  new ProofToPayService(
    evidenceService,
    verificationService,
    qaService,
    creditEngine
  );

walletService.createWallet(
  worker.id,
  1250,
  2000,
  500
);

budgetService.createBudget(
  "budget-worker-001",
  worker.id,
  1000,
  600
);

evidenceService.create(
  "evidence-001",
  "task-production",
  worker.id,
  "test_result",
  "Frontend tests",
  "All frontend tests passed.",
  "test-run-001"
);

const verification =
  verificationService.create(
    "verification-001",
    "task-production",
    evidenceService.getByTask(
      "task-production"
    )
  );

verificationService.pass(
  verification.id,
  96,
  "Verification passed.",
  "qa-agent-001"
);

qaService.create(
  "qa-001",
  "task-production",
  [
    "Unit tests",
    "Integration tests",
    "Security checks",
  ]
);

qaService.pass(
  "qa-001",
  98,
  "qa-agent-001"
);

const paid =
  proofToPay.pay({
    id: "payment-001",
    agent: worker,
    taskId: "task-production",
    amount: 300,
    reason: "Approved API service usage",
    riskScore: 10,
    budgetId: "budget-worker-001",
  });

console.log(
  "\nSUCCESSFUL PROOF-TO-PAY:"
);
console.log(paid);

if (
  paid.status !== "paid" ||
  paid.creditResult?.decision !== "ALLOW"
) {
  throw new Error(
    "Expected payment to be released"
  );
}

const rejected =
  proofToPay.pay({
    id: "payment-002",
    agent: worker,
    taskId: "task-without-proof",
    amount: 100,
    reason: "Unverified work",
    riskScore: 10,
    budgetId: "budget-worker-001",
  });

console.log(
  "\nPAYMENT WITHOUT PROOF:"
);
console.log(rejected);

if (rejected.status !== "rejected") {
  throw new Error(
    "Expected payment without evidence to be rejected"
  );
}

const escalated =
  proofToPay.pay({
    id: "payment-003",
    agent: worker,
    taskId: "task-production",
    amount: 200,
    reason: "Higher-risk service usage",
    riskScore: 60,
    budgetId: "budget-worker-001",
  });

console.log(
  "\nESCALATED PAYMENT:"
);
console.log(escalated);

if (
  escalated.status !== "awaiting_approval"
) {
  throw new Error(
    "Expected high-risk payment to require approval"
  );
}

console.log(
  "\nProofToPay tests passed."
);
