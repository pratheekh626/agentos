import {
  TransactionService,
} from "./index";

const transactions =
  new TransactionService();

const transaction =
  transactions.create(
    "tx-001",
    "worker-001",
    "debit",
    300,
    "API service usage",
    "task-production"
  );

console.log("CREATED:");
console.log(transaction);

if (
  transaction.status !== "pending"
) {
  throw new Error(
    "New transaction should be pending"
  );
}

const approved =
  transactions.approve("tx-001");

console.log("\nAPPROVED:");
console.log(approved);

if (
  approved.status !== "approved"
) {
  throw new Error(
    "Transaction was not approved"
  );
}

const completed =
  transactions.complete("tx-001");

console.log("\nCOMPLETED:");
console.log(completed);

if (
  completed.status !== "completed"
) {
  throw new Error(
    "Transaction was not completed"
  );
}

if (
  !completed.completedAt
) {
  throw new Error(
    "Completed transaction should have completion time"
  );
}

const rejected =
  transactions.create(
    "tx-002",
    "worker-001",
    "debit",
    900,
    "Restricted API",
    "task-security"
  );

const rejectedResult =
  transactions.reject(
    "tx-002",
    "Policy denied transaction"
  );

console.log("\nREJECTED:");
console.log(rejectedResult);

if (
  rejectedResult.status !== "rejected"
) {
  throw new Error(
    "Transaction was not rejected"
  );
}

const agentTransactions =
  transactions.getByAgent(
    "worker-001"
  );

if (
  agentTransactions.length !== 2
) {
  throw new Error(
    "Agent transaction lookup failed"
  );
}

const taskTransactions =
  transactions.getByTask(
    "task-production"
  );

if (
  taskTransactions.length !== 1
) {
  throw new Error(
    "Task transaction lookup failed"
  );
}

console.log(
  "\nTRANSACTIONS:",
  transactions.getAll()
);

console.log(
  "\nTransaction tests passed."
);
