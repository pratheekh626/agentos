import { AuditLedger } from "../AuditLedger";
import { AuditEventBridge } from "./index";
import { EventBus } from "../../messaging/EventBus";
import { ExecutionEvents } from "../../agents/Execution";

const ledger = new AuditLedger();
const eventBus = new EventBus<ExecutionEvents>();
const bridge = new AuditEventBridge(ledger, eventBus);

eventBus.emit("execution.evidence_created", {
  id: "evidence-1",
  taskId: "task-1",
  agentId: "worker-1",
  type: "test_result",
  title: "Build tests",
  description: "All tests passed",
  reference: "test://result-1",
  createdAt: "2026-09-11T00:00:00.000Z",
});

const events = ledger.getAll();

if (events.length !== 1) {
  throw new Error(`Expected 1 audit event, got ${events.length}`);
}

const event = events[0];

if (event.type !== "EVIDENCE_SUBMITTED") {
  throw new Error(`Unexpected audit event type: ${event.type}`);
}

if (event.actorId !== "worker-1") {
  throw new Error("Incorrect audit actor");
}

if (event.targetId !== "evidence-1") {
  throw new Error("Incorrect audit target");
}

if (event.taskId !== "task-1") {
  throw new Error("Incorrect audit task");
}

if (event.action !== "evidence_submitted") {
  throw new Error("Incorrect audit action");
}

if (event.details?.evidenceType !== "test_result") {
  throw new Error("Evidence type was not recorded");
}

if (!ledger.verifyIntegrity()) {
  throw new Error("Audit ledger integrity check failed");
}

bridge.disconnect();

eventBus.emit("execution.evidence_created", {
  id: "evidence-2",
  taskId: "task-2",
  agentId: "worker-1",
  type: "log",
  title: "Second evidence",
  description: "Should not be audited after disconnect",
  reference: "log://result-2",
  createdAt: "2026-09-11T00:01:00.000Z",
});

if (ledger.getAll().length !== 1) {
  throw new Error("Audit bridge did not disconnect correctly");
}

console.log("AuditEventBridge tests passed");