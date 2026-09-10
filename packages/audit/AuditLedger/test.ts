import { AuditLedger } from "./index";

const ledger = new AuditLedger();

const taskId = "task-production";

const taskCreated = ledger.append({
  id: "audit-001",
  type: "TASK_CREATED",
  actorId: "boss-001",
  taskId,
  action: "Created production task",
  details: {
    title: "Build SaaS website",
    priority: "high",
  },
});

const delegation = ledger.append({
  id: "audit-002",
  type: "TASK_DELEGATED",
  actorId: "manager-001",
  targetId: "worker-001",
  taskId,
  action: "Delegated frontend implementation",
  details: {
    component: "frontend",
  },
});

const payment = ledger.append({
  id: "audit-003",
  type: "PAYMENT_RELEASED",
  actorId: "worker-001",
  targetId: "worker-001",
  taskId,
  action: "Released verified payment",
  details: {
    amount: 300,
    currency: "credits",
  },
});

console.log("\nAUDIT EVENTS:");
console.log(ledger.getAll());

console.log("\nTASK EVENTS:");
console.log(ledger.getByTask(taskId));

console.log("\nWORKER EVENTS:");
console.log(ledger.getByActor("worker-001"));

console.log("\nPAYMENT EVENTS:");
console.log(ledger.getByType("PAYMENT_RELEASED"));

console.log("\nCHAIN:");
console.log({
  firstHash: taskCreated.eventHash,
  secondPreviousHash: delegation.previousEventHash,
  secondHash: delegation.eventHash,
  thirdPreviousHash: payment.previousEventHash,
});

if (delegation.previousEventHash !== taskCreated.eventHash) {
  throw new Error("Audit chain is broken");
}

if (payment.previousEventHash !== delegation.eventHash) {
  throw new Error("Audit chain is broken");
}

if (!ledger.verifyIntegrity()) {
  throw new Error("Audit integrity check failed");
}

console.log("\nINTEGRITY CHECK: PASSED");

try {
  ledger.append({
    id: "audit-003",
    type: "TASK_CREATED",
    actorId: "boss-001",
    taskId,
    action: "Duplicate event",
  });

  throw new Error("Duplicate event was accepted");
} catch (error) {
  console.log(
    "\nDUPLICATE EVENT CHECK:",
    error instanceof Error ? error.message : error
  );
}

console.log("\nAudit Ledger tests passed.");
