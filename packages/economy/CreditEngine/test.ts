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
} from "../Wallet";

import {
  BudgetService,
} from "../Budget";

import {
  TransactionService,
} from "../Transactions";

import {
  CreditEngine,
} from "./index";

const registry =
  new AgentRegistry();

const manager =
  createManager(
    "manager-001",
    "Engineering Manager",
    "boss-001"
  );

const worker =
  createWorker(
    "worker-001",
    "Frontend Developer",
    manager.id
  );

registry.register(manager);
registry.register(worker);

const permissionEngine =
  new PermissionEngine();

const policyEngine =
  new PolicyEngine();

const wallets =
  new WalletService();

wallets.createWallet(
  worker.id,
  1250,
  2000,
  500
);

const budgets =
  new BudgetService();

budgets.createBudget(
  "budget-worker-001",
  worker.id,
  1000,
  600
);

const transactions =
  new TransactionService();

const creditEngine =
  new CreditEngine(
    permissionEngine,
    policyEngine,
    wallets,
    budgets,
    transactions
  );

const allowed =
  creditEngine.requestCredits({
    id: "tx-credit-001",
    agent: worker,
    amount: 300,
    reason: "API service usage",
    taskId: "task-production",
    riskScore: 10,
    budgetId: "budget-worker-001",
  });

console.log(
  "ALLOWED REQUEST:"
);
console.log(allowed);

if (
  allowed.decision !== "ALLOW"
) {
  throw new Error(
    "Expected low-risk request to be allowed"
  );
}

const walletAfter =
  wallets.getWallet(worker.id);

if (
  !walletAfter ||
  walletAfter.balance !== 950
) {
  throw new Error(
    "Wallet was not debited correctly"
  );
}

const budgetAfter =
  budgets.getBudget(
    "budget-worker-001"
  );

if (
  !budgetAfter ||
  budgetAfter.spent !== 300
) {
  throw new Error(
    "Budget was not updated correctly"
  );
}

if (
  allowed.transaction?.status !==
  "completed"
) {
  throw new Error(
    "Allowed transaction was not completed"
  );
}

const escalated =
  creditEngine.requestCredits({
    id: "tx-credit-002",
    agent: worker,
    amount: 200,
    reason: "External service",
    taskId: "task-production",
    riskScore: 60,
    budgetId: "budget-worker-001",
  });

console.log(
  "\nESCALATED REQUEST:"
);
console.log(escalated);

if (
  escalated.decision !== "ESCALATE"
) {
  throw new Error(
    "Expected medium-risk request to escalate"
  );
}

const denied =
  creditEngine.requestCredits({
    id: "tx-credit-003",
    agent: worker,
    amount: 200,
    reason: "Dangerous operation",
    taskId: "task-security",
    riskScore: 90,
    budgetId: "budget-worker-001",
  });

console.log(
  "\nDENIED REQUEST:"
);
console.log(denied);

if (
  denied.decision !== "DENY"
) {
  throw new Error(
    "Expected high-risk request to be denied"
  );
}

console.log(
  "\nFinal wallet:"
);
console.log(
  wallets.getWallet(worker.id)
);

console.log(
  "\nFinal budget:"
);
console.log(
  budgets.getBudget(
    "budget-worker-001"
  )
);

console.log(
  "\nCreditEngine tests passed."
);
