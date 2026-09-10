import { AgentMessageService } from "../../messaging/AgentMessages";
import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { ApprovalEngine } from "../../governance/ApprovalEngine";
import { EscalationService } from "../Escalation";
import { InterventionService } from "./index";

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
const escalations = new EscalationService(
  registry,
  new ApprovalEngine(),
  messages
);
const interventions = new InterventionService(
  registry,
  messages,
  escalations
);

const approvedEscalation = escalations.escalate({
  id: "escalation-approved",
  managerId: manager.id,
  bossId: boss.id,
  taskId: "task-blocked",
  reason: "Worker needs an organizational decision.",
});

if (!approvedEscalation.escalation) {
  throw new Error("Expected approved escalation fixture");
}

escalations.approveEscalation(
  approvedEscalation.escalation.id,
  boss.id
);

const applied = interventions.intervene({
  id: "intervention-001",
  escalationId: approvedEscalation.escalation.id,
  bossId: boss.id,
  action: "send_instruction",
  instruction: "Proceed with the approved fallback plan.",
});

if (
  applied.decision !== "APPLIED" ||
  !applied.intervention ||
  interventions.get("intervention-001")?.taskId !==
    "task-blocked"
) {
  throw new Error("Expected approved escalation intervention");
}

if (
  applied.message?.toAgentId !== manager.id ||
  applied.message.type !== "notification"
) {
  throw new Error("Expected manager intervention notification");
}

const pendingEscalation = escalations.escalate({
  id: "escalation-pending",
  managerId: manager.id,
  bossId: boss.id,
  taskId: "task-pending",
  reason: "Pending decision.",
});

if (!pendingEscalation.escalation) {
  throw new Error("Expected pending escalation fixture");
}

if (
  interventions.intervene({
    id: "intervention-pending",
    escalationId: pendingEscalation.escalation.id,
    bossId: boss.id,
    action: "request_update",
    instruction: "Request an update.",
  }).decision !== "DENY"
) {
  throw new Error("Expected pending escalation denial");
}

const rejectedEscalation = escalations.escalate({
  id: "escalation-rejected",
  managerId: manager.id,
  bossId: boss.id,
  taskId: "task-rejected",
  reason: "Will be rejected.",
});

if (!rejectedEscalation.escalation) {
  throw new Error("Expected rejected escalation fixture");
}

escalations.rejectEscalation(
  rejectedEscalation.escalation.id,
  boss.id
);

if (
  interventions.intervene({
    id: "intervention-rejected",
    escalationId: rejectedEscalation.escalation.id,
    bossId: boss.id,
    action: "resume_worker",
    instruction: "Resume the worker.",
  }).decision !== "DENY"
) {
  throw new Error("Expected rejected escalation denial");
}

if (
  interventions.intervene({
    id: "intervention-unrelated-boss",
    escalationId: approvedEscalation.escalation.id,
    bossId: otherBoss.id,
    action: "send_instruction",
    instruction: "This must be denied.",
  }).decision !== "DENY"
) {
  throw new Error("Expected unrelated Boss denial");
}

if (
  interventions.intervene({
    id: "intervention-non-boss",
    escalationId: approvedEscalation.escalation.id,
    bossId: manager.id,
    action: "send_instruction",
    instruction: "This must be denied.",
  }).decision !== "DENY"
) {
  throw new Error("Expected non-Boss denial");
}

if (
  interventions.intervene({
    id: "intervention-missing-escalation",
    escalationId: "missing-escalation",
    bossId: boss.id,
    action: "send_instruction",
    instruction: "This must be denied.",
  }).decision !== "DENY"
) {
  throw new Error("Expected missing escalation denial");
}

if (
  interventions.intervene({
    id: "intervention-empty-instruction",
    escalationId: approvedEscalation.escalation.id,
    bossId: boss.id,
    action: "send_instruction",
    instruction: "",
  }).decision !== "DENY"
) {
  throw new Error("Expected empty instruction denial");
}

if (
  messages.getByAgent(manager.id).filter(
    (message) =>
      message.fromAgentId === boss.id &&
      message.type === "notification"
  ).length !== 1
) {
  throw new Error("Expected only one intervention message");
}

console.log("Intervention tests passed.");