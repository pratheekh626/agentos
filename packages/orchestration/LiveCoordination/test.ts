import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";
import { OrganizationService } from "../../agents/Organization";
import { ConferenceRoomService } from "../../agents/ConferenceRoom";
import { AgentRuntime } from "../../agents/Runtime";
import { AgentMessageService } from "../../messaging/AgentMessages";
import { TaskDispatcher } from "../TaskDispatcher";
import { DependencyManager } from "../Dependencies";
import { DelegationService } from "../Delegation";
import { Scheduler } from "../Scheduler";
import { RecoveryService } from "../Recovery";
import { EscalationService } from "../Escalation";
import { InterventionService } from "../Intervention";
import { ManagerAllocationService } from "../ManagerAllocation";
import { ManagerTaskLifecycle } from "../ManagerTaskLifecycle";
import { ApprovalEngine } from "../../governance/ApprovalEngine";
import { DelegationFirewall } from "../../governance/DelegationFirewall";
import { PermissionEngine } from "../../governance/PermissionEngine";
import { PolicyEngine } from "../../governance/PolicyEngine";
import { IdentityService } from "../../security/Identity";
import { AccessControlService } from "../../security/AccessControl";
import { RiskEngine } from "../../security/RiskEngine";
import { AnomalyDetectionService } from "../../security/AnomalyDetection";
import { KillSwitchService } from "../../security/KillSwitch";
import { SecurityGateway } from "../../security/SecurityGateway";
import { WalletService } from "../../economy/Wallet";
import { LiveCoordinationService } from "./index";
import type { Task } from "../../core/Task";

const registry = new AgentRegistry();
const boss = createBoss("boss-lc", "Boss");
const manager = createManager("manager-lc", "Manager", boss.id);
const otherManager = createManager("mgr-other", "Other Manager", boss.id);
const worker = createWorker("worker-lc", "Worker", manager.id);
const otherWorker = createWorker("worker-other", "Other Worker", otherManager.id);

for (const a of [boss, manager, otherManager, worker, otherWorker]) registry.register(a);

const identity = new IdentityService();
for (const a of [boss, manager, otherManager, worker, otherWorker]) identity.createIdentity({ agentId: a.id, role: a.role });

const wallet = new WalletService();
const security = new SecurityGateway(identity, new AccessControlService(identity), new RiskEngine(), new AnomalyDetectionService(), new KillSwitchService(identity, wallet));
const messages = new AgentMessageService();
const dispatcher = new TaskDispatcher(registry);
const depMgr = new DependencyManager();
const delegation = new DelegationService(registry, new DelegationFirewall(new PermissionEngine(), new PolicyEngine()), new ApprovalEngine(), dispatcher, security);
const scheduler = new Scheduler(registry, depMgr, delegation);
const runtime = new AgentRuntime(registry, dispatcher, depMgr, delegation, scheduler, messages);
const organization = new OrganizationService(registry);
organization.createOrganization("org-lc", "AGENTOS", boss.id, "now");
organization.addManager(manager.id, "frontend");
organization.addManager(otherManager.id, "backend");
organization.addWorker(worker.id, "frontend");
organization.addWorker(otherWorker.id, "backend");

const conference = new ConferenceRoomService(registry, messages);
const meeting = conference.createMeeting({ id: "meeting-lc", projectId: "proj-lc", calledBy: boss.id, participants: [manager.id], agenda: "Live Coordination" });
conference.startMeeting(meeting.id);
const decision = conference.createDecision({ id: "decision-lc", meetingId: meeting.id, decidedBy: boss.id, decisionType: "ASSIGN_MANAGER", summary: "Assign manager", taskIds: ["task-parent"], managerId: manager.id });
conference.completeMeeting(meeting.id);

const allocationSvc = new ManagerAllocationService(registry, organization, conference, runtime, messages);
const recovery = new RecoveryService(registry, dispatcher, delegation, messages, 1);
const approvalEngine = new ApprovalEngine();
const escalation = new EscalationService(registry, approvalEngine, messages);
const intervention = new InterventionService(registry, messages, escalation);
const lifecycle = new ManagerTaskLifecycle(registry, organization, allocationSvc, runtime, depMgr, recovery, escalation);

const coord = new LiveCoordinationService(registry, allocationSvc, lifecycle, runtime, messages, escalation, intervention);

const parentTask: Task = {
  id: "task-parent",
  title: "Parent Task",
  description: "Parent description",
  assignedTo: null,
  createdBy: manager.id,
  status: "queued",
  priority: "high",
  dependencies: [],
  budget: 0, spent: 0, createdAt: "now", updatedAt: "now",
};

const tasks = new Map<string, Task>([["task-parent", parentTask]]);

allocationSvc.createAllocation({
  id: "alloc-lc",
  organizationId: "org-lc",
  meetingId: meeting.id,
  decisionId: decision.id,
  projectId: "proj-lc",
  managerId: manager.id,
  taskIds: ["task-parent"],
  decomposeTaskIds: ["task-parent"],
  assignedBy: boss.id,
}, tasks);

allocationSvc.approveAllocation("alloc-lc", boss.id);
allocationSvc.activateAllocation("alloc-lc", tasks);

// Decompose parent task into subtasks
lifecycle.decomposeAllocatedTask("alloc-lc", manager.id, parentTask, [
  { id: "sub-1", title: "Subtask 1", description: "Sub 1", priority: "high" },
  { id: "sub-recover", title: "Subtask Recover", description: "Recover test", priority: "high" },
], tasks);

const sub1 = tasks.get("sub-1")!;

// ── TEST 1: Authorized manager progress monitoring ───────────────────────────
coord.delegateSubtask("alloc-lc", manager.id, sub1, worker.id, tasks);
coord.sendWorkerProgress(worker.id, manager.id, sub1.id, "alloc-lc", "50% completed", tasks);

const mon = coord.getWorkerProgress(manager.id, worker.id, "alloc-lc", tasks);
if (mon.decision !== "OK" || mon.progressMessages.length === 0) {
  throw new Error("TEST 1 FAILED: Manager progress monitoring failed");
}
console.log("TEST 1 passed: Authorized manager progress monitoring");

// ── TEST 2: Unauthorized manager rejection ──────────────────────────────────
const monUnauth = coord.getWorkerProgress(otherManager.id, worker.id, "alloc-lc", tasks);
if (monUnauth.decision !== "REJECTED") {
  throw new Error("TEST 2 FAILED: Unauthorized manager should be rejected");
}
console.log("TEST 2 passed: Unauthorized manager rejection");

// ── TEST 3: Wrong-worker hierarchy rejection ─────────────────────────────────
const progWrongWorker = coord.sendWorkerProgress(otherWorker.id, manager.id, sub1.id, "alloc-lc", "Should fail", tasks);
if (progWrongWorker.decision !== "REJECTED" || !progWrongWorker.reason.includes("does not belong")) {
  throw new Error("TEST 3 FAILED: Wrong-worker hierarchy should be rejected");
}
console.log("TEST 3 passed: Wrong-worker hierarchy rejection");

// ── TEST 4: Progress/status A2A message delivery ─────────────────────────────
const progDelivered = messages.getByAgent(manager.id).find((m) => m.type === "status_update" && m.taskId === sub1.id);
if (!progDelivered || progDelivered.content !== "50% completed") {
  throw new Error("TEST 4 FAILED: Progress A2A message not delivered to manager");
}
console.log("TEST 4 passed: Progress/status A2A message delivery");

// ── TEST 5: Blocker A2A message delivery ──────────────────────────────────────
const blockerRep = coord.reportWorkerBlocker(worker.id, manager.id, sub1.id, "alloc-lc", "Blocked on database", tasks);
if (blockerRep.decision !== "REPORTED" || !blockerRep.message) {
  throw new Error("TEST 5 FAILED: Blocker A2A message report failed");
}
const blockerMsg = messages.getByAgent(manager.id).find((m) => m.type === "notification" && m.subject.includes("Blocker reported"));
if (!blockerMsg) {
  throw new Error("TEST 5 FAILED: Blocker notification message not found in manager inbox");
}
console.log("TEST 5 passed: Blocker A2A message delivery");

// ── TEST 6: Recovery path execution ──────────────────────────────────────────
const subRecover = tasks.get("sub-recover")!;
const assignedSubRecover = { ...subRecover, assignedTo: worker.id, status: "assigned" as const };
tasks.set("sub-recover", assignedSubRecover);
registry.update(worker.id, { status: "idle" });

const recoveryRes = coord.handleBlocker("alloc-lc", manager.id, assignedSubRecover, "Worker process failure", tasks);
if (recoveryRes.decision !== "RECOVERED" || !recoveryRes.recovery) {
  throw new Error(`TEST 6 FAILED: Expected RECOVERED, got ${recoveryRes.decision}: ${recoveryRes.reason}`);
}
console.log("TEST 6 passed: Recovery path execution");

// ── TEST 7: Escalation path execution ─────────────────────────────────────────
// Second blocker exhausts recovery count (maxRetries = 1)
const escalationRes = coord.handleBlocker("alloc-lc", manager.id, assignedSubRecover, "Repeated process failure", tasks);
if (escalationRes.decision !== "ESCALATED" || !escalationRes.escalation) {
  throw new Error(`TEST 7 FAILED: Expected ESCALATED, got ${escalationRes.decision}: ${escalationRes.reason}`);
}
console.log("TEST 7 passed: Escalation path execution");

// ── TEST 8: Boss-only escalation approval/rejection ──────────────────────────
const escalRecord = escalationRes.escalation!.escalation!;


// Non-boss approval fails
const unauthApprove = coord.approveEscalation(manager.id, escalRecord.id);
if (unauthApprove.decision !== "DENY") {
  throw new Error("TEST 8 FAILED: Non-boss approval should be denied");
}

// Boss approval succeeds
const bossApprove = coord.approveEscalation(boss.id, escalRecord.id);
if (bossApprove.decision !== "APPROVED") {
  throw new Error(`TEST 8 FAILED: Boss approval failed: ${bossApprove.reason}`);
}
console.log("TEST 8 passed: Boss-only escalation approval");

// ── TEST 9: Intervention delivery ────────────────────────────────────────────
const interventionRes = coord.applyBossIntervention(
  boss.id,
  escalRecord.id,
  "intervention-lc-1",
  "send_instruction",
  "Reallocate task to backup pool"
);

if (interventionRes.decision !== "APPLIED" || !interventionRes.message) {
  throw new Error(`TEST 9 FAILED: Intervention application failed: ${interventionRes.reason}`);
}

const managerInterventions = coord.getManagerInterventions(manager.id);
if (managerInterventions.length === 0 || !managerInterventions[0].content.includes("Reallocate task")) {
  throw new Error("TEST 9 FAILED: Manager did not receive intervention A2A notification");
}
console.log("TEST 9 passed: Intervention delivery to manager");

// ── TEST 10: Inactive allocation rejection ────────────────────────────────────
// Create a proposed allocation
allocationSvc.createAllocation({
  id: "alloc-proposed",
  organizationId: "org-lc",
  meetingId: meeting.id,
  decisionId: decision.id,
  projectId: "proj-lc",
  managerId: manager.id,
  taskIds: ["task-parent"],
  assignedBy: boss.id,
}, tasks);

const inactiveProg = coord.sendWorkerProgress(worker.id, manager.id, sub1.id, "alloc-proposed", "Should fail", tasks);
if (inactiveProg.decision !== "REJECTED" || !inactiveProg.reason.includes("not ACTIVE")) {
  throw new Error("TEST 10 FAILED: Inactive allocation should reject worker progress update");
}
console.log("TEST 10 passed: Inactive allocation rejection");

// ── TEST 11: Task outside allocation rejection ───────────────────────────────
const outsideTask: Task = {
  id: "task-outside", title: "Outside", description: "", assignedTo: null, createdBy: manager.id,
  status: "queued", priority: "low", dependencies: [], budget: 0, spent: 0, createdAt: "now", updatedAt: "now"
};
tasks.set("task-outside", outsideTask);

const outsideProg = coord.sendWorkerProgress(worker.id, manager.id, outsideTask.id, "alloc-lc", "Should fail", tasks);
if (outsideProg.decision !== "REJECTED" || !outsideProg.reason.includes("not authorized")) {
  throw new Error("TEST 11 FAILED: Task outside allocation should be rejected");
}
console.log("TEST 11 passed: Task outside allocation rejection");

// ── TEST 12: Paused/offline worker rejection ─────────────────────────────────
registry.update(worker.id, { status: "paused" });
const pausedProg = coord.sendWorkerProgress(worker.id, manager.id, sub1.id, "alloc-lc", "Should fail", tasks);
if (pausedProg.decision !== "REJECTED" || !pausedProg.reason.includes("unavailable")) {
  throw new Error("TEST 12 FAILED: Paused worker progress update should be rejected");
}

registry.update(worker.id, { status: "offline" });
const offlineProg = coord.sendWorkerProgress(worker.id, manager.id, sub1.id, "alloc-lc", "Should fail", tasks);
if (offlineProg.decision !== "REJECTED" || !offlineProg.reason.includes("unavailable")) {
  throw new Error("TEST 12 FAILED: Offline worker progress update should be rejected");
}
registry.update(worker.id, { status: "idle" });
console.log("TEST 12 passed: Paused/offline worker rejection");

// ── TEST 13: Preservation of existing task completion invariants ────────────
try {
  dispatcher.finalizeTask(sub1); // sub1 is status="assigned", NOT "verification"
  throw new Error("TEST 13 FAILED: finalizeTask should have rejected assigned task");
} catch (err) {
  if (!(err instanceof Error) || !err.message.includes("Only tasks in verification status can be finalized")) {
    throw new Error(`TEST 13 FAILED: Unexpected error: ${err}`);
  }
}
console.log("TEST 13 passed: Preservation of task completion invariants");

console.log("\n✅ All LiveCoordination unit tests passed.");
