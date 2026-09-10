import { AgentMessageService } from "../../messaging/AgentMessages";
import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { ApprovalEngine } from "../../governance/ApprovalEngine";
import { EscalationService } from "./index";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const otherBoss = createBoss("boss-002", "Other Boss");
const manager = createManager(
  "manager-001",
  "Engineering Manager",
  boss.id
);

registry.register(boss);
registry.register(otherBoss);
registry.register(manager);

const messages = new AgentMessageService();
const escalation = new EscalationService(
  registry,
  new ApprovalEngine(),
  messages
);

let createdEvents = 0;
let approvedEvents = 0;
let rejectedEvents = 0;

escalation.events.on("escalation.created", () => {
  createdEvents += 1;
});
escalation.events.on("escalation.approved", () => {
  approvedEvents += 1;
});
escalation.events.on("escalation.rejected", () => {
  rejectedEvents += 1;
});

const pending = escalation.escalate({
  id: "escalation-001",
  managerId: manager.id,
  bossId: boss.id,
  taskId: "task-blocked",
  reason: "Worker is blocked waiting for production credentials.",
});

if (
  pending.decision !== "PENDING" ||
  !pending.escalation ||
  !pending.approval ||
  pending.approval.status !== "pending"
) {
  throw new Error("Expected valid escalation to be pending");
}

if (createdEvents !== 1) {
  throw new Error("Expected escalation.created event");
}

if (
  pending.message?.toAgentId !== boss.id ||
  pending.message.type !== "approval_request"
) {
  throw new Error("Expected Boss to receive escalation notification");
}

const unauthorizedApproval = escalation.approveEscalation(
  pending.escalation.id,
  otherBoss.id
);

if (unauthorizedApproval.decision !== "DENY") {
  throw new Error("Expected unrelated Boss approval to be denied");
}

if (approvedEvents !== 0) {
  throw new Error("Unauthorized approval emitted an event");
}

const approved = escalation.approveEscalation(
  pending.escalation.id,
  boss.id
);

if (
  approved.decision !== "APPROVED" ||
  approved.approval?.status !== "approved" ||
  approved.message?.toAgentId !== manager.id
) {
  throw new Error("Expected assigned Boss approval");
}

if (Number(approvedEvents) !== 1) {
  throw new Error("Expected escalation.approved event");
}

const nonManager = escalation.escalate({
  id: "escalation-002",
  managerId: boss.id,
  bossId: boss.id,
  taskId: "task-invalid",
  reason: "Invalid source",
});

if (nonManager.decision !== "DENY") {
  throw new Error("Expected non-manager escalation to be denied");
}

const unrelatedBoss = escalation.escalate({
  id: "escalation-003",
  managerId: manager.id,
  bossId: otherBoss.id,
  taskId: "task-invalid",
  reason: "Wrong Boss",
});

if (unrelatedBoss.decision !== "DENY") {
  throw new Error("Expected unrelated Boss escalation to be denied");
}

if (createdEvents !== 1) {
  throw new Error("Invalid escalations emitted created events");
}

const missingTask = escalation.escalate({
  id: "escalation-004",
  managerId: manager.id,
  bossId: boss.id,
  taskId: "",
  reason: "Missing task",
});

if (missingTask.decision !== "DENY") {
  throw new Error("Expected missing task escalation to be denied");
}

const missingReason = escalation.escalate({
  id: "escalation-005",
  managerId: manager.id,
  bossId: boss.id,
  taskId: "task-invalid",
  reason: "",
});

if (missingReason.decision !== "DENY") {
  throw new Error("Expected missing reason escalation to be denied");
}

const rejectedPending = escalation.escalate({
  id: "escalation-006",
  managerId: manager.id,
  bossId: boss.id,
  taskId: "task-risk",
  reason: "Requesting intervention for a risky change.",
});

if (!rejectedPending.escalation) {
  throw new Error("Expected rejection fixture to be pending");
}

const rejected = escalation.rejectEscalation(
  rejectedPending.escalation.id,
  boss.id
);

if (
  rejected.decision !== "REJECTED" ||
  rejected.approval?.status !== "rejected"
) {
  throw new Error("Expected assigned Boss rejection");
}

if (Number(createdEvents) !== 2 || Number(rejectedEvents) !== 1) {
  throw new Error("Expected escalation.rejected event");
}

if (
  messages.getByAgent(boss.id).filter(
    (message) => message.toAgentId === boss.id
  ).length !== 2
) {
  throw new Error("Expected two escalation notifications for Boss");
}

console.log("Escalation tests passed.");