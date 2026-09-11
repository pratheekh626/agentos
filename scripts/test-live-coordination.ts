/**
 * Integration Test: Boss ↔ Manager ↔ Worker Live Coordination
 *
 * Exercises the end-to-end live coordination workflow connecting:
 *   ACTIVE allocation
 *   → Manager delegates task to worker
 *   → Worker sends progress update via A2A
 *   → Manager retrieves progress updates
 *   → Worker reports blocker via A2A
 *   → Manager handles blocker (Recovery → Escalation)
 *   → Boss receives escalation notification via A2A
 *   → Boss approves escalation
 *   → Boss applies intervention via InterventionService
 *   → Manager receives intervention notification via A2A
 */

import { AgentRegistry } from "../packages/agents/AgentRegistry";
import { createBoss } from "../packages/agents/Boss";
import { createManager } from "../packages/agents/Managers";
import { createWorker } from "../packages/agents/Workers";
import { OrganizationService } from "../packages/agents/Organization";
import { ConferenceRoomService } from "../packages/agents/ConferenceRoom";
import { AgentRuntime } from "../packages/agents/Runtime";
import { AgentMessageService } from "../packages/messaging/AgentMessages";
import { TaskDispatcher } from "../packages/orchestration/TaskDispatcher";
import { DependencyManager } from "../packages/orchestration/Dependencies";
import { DelegationService } from "../packages/orchestration/Delegation";
import { Scheduler } from "../packages/orchestration/Scheduler";
import { RecoveryService } from "../packages/orchestration/Recovery";
import { EscalationService } from "../packages/orchestration/Escalation";
import { InterventionService } from "../packages/orchestration/Intervention";
import { ManagerAllocationService } from "../packages/orchestration/ManagerAllocation";
import { ManagerTaskLifecycle } from "../packages/orchestration/ManagerTaskLifecycle";
import { LiveCoordinationService } from "../packages/orchestration/LiveCoordination";
import { ApprovalEngine } from "../packages/governance/ApprovalEngine";
import { DelegationFirewall } from "../packages/governance/DelegationFirewall";
import { PermissionEngine } from "../packages/governance/PermissionEngine";
import { PolicyEngine } from "../packages/governance/PolicyEngine";
import { IdentityService } from "../packages/security/Identity";
import { AccessControlService } from "../packages/security/AccessControl";
import { RiskEngine } from "../packages/security/RiskEngine";
import { AnomalyDetectionService } from "../packages/security/AnomalyDetection";
import { KillSwitchService } from "../packages/security/KillSwitch";
import { SecurityGateway } from "../packages/security/SecurityGateway";
import { WalletService } from "../packages/economy/Wallet";
import { AuditLedger } from "../packages/audit/AuditLedger";
import { AuditEventBridge } from "../packages/audit/EventBridge";
import { EventBus } from "../packages/messaging/EventBus";
import type { Task } from "../packages/core/Task";
import type { ExecutionEvents } from "../packages/agents/Execution";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── Agents & Registry ─────────────────────────────────────────────────────────

const registry = new AgentRegistry();
const boss = createBoss("boss-e2e-live", "Boss");
const manager = createManager("manager-e2e-live", "Engineering Manager", boss.id);
const worker = createWorker("worker-e2e-live", "Frontend Developer", manager.id);

for (const a of [boss, manager, worker]) registry.register(a);

// ── Infrastructure & Security ─────────────────────────────────────────────────

const messages = new AgentMessageService();
const identity = new IdentityService();
for (const a of [boss, manager, worker]) identity.createIdentity({ agentId: a.id, role: a.role });

const wallet = new WalletService();
const security = new SecurityGateway(identity, new AccessControlService(identity), new RiskEngine(), new AnomalyDetectionService(), new KillSwitchService(identity, wallet));
const dispatcher = new TaskDispatcher(registry);
const depMgr = new DependencyManager();
const delegation = new DelegationService(registry, new DelegationFirewall(new PermissionEngine(), new PolicyEngine()), new ApprovalEngine(), dispatcher, security);
const scheduler = new Scheduler(registry, depMgr, delegation);
const runtime = new AgentRuntime(registry, dispatcher, depMgr, delegation, scheduler, messages);
const recovery = new RecoveryService(registry, dispatcher, delegation, messages, 1);
const approvalEngine = new ApprovalEngine();
const escalation = new EscalationService(registry, approvalEngine, messages);
const intervention = new InterventionService(registry, messages, escalation);

const organization = new OrganizationService(registry);
organization.createOrganization("org-e2e-live", "AGENTOS", boss.id, "2026-09-11T00:00:00.000Z");
organization.addManager(manager.id, "frontend");
organization.addWorker(worker.id, "frontend");

const conference = new ConferenceRoomService(registry, messages);
const meeting = conference.createMeeting({ id: "meeting-e2e-live", projectId: "proj-e2e-live", calledBy: boss.id, participants: [manager.id], agenda: "Live coordination" });
conference.startMeeting(meeting.id);
const decision = conference.createDecision({ id: "decision-e2e-live", meetingId: meeting.id, decidedBy: boss.id, decisionType: "ASSIGN_MANAGER", summary: "Manager responsibility", taskIds: ["task-live-parent"], managerId: manager.id });
conference.completeMeeting(meeting.id);

const allocationSvc = new ManagerAllocationService(registry, organization, conference, runtime, messages);
const lifecycle = new ManagerTaskLifecycle(registry, organization, allocationSvc, runtime, depMgr, recovery, escalation);
const coordination = new LiveCoordinationService(registry, allocationSvc, lifecycle, runtime, messages, escalation, intervention);

const audit = new AuditLedger();
const executionBus = new EventBus<ExecutionEvents>();
new AuditEventBridge(audit, executionBus, undefined, undefined, undefined, undefined, undefined, undefined, undefined, allocationSvc.events);

// ── Step 1: Allocation ACTIVE & Task Decomposition ────────────────────────────

const parentTask: Task = {
  id: "task-live-parent",
  title: "Frontend Live Module",
  description: "Live module implementation",
  assignedTo: null,
  createdBy: manager.id,
  status: "queued",
  priority: "high",
  dependencies: [],
  budget: 0, spent: 0, createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z",
};

const tasks = new Map<string, Task>([["task-live-parent", parentTask]]);

allocationSvc.createAllocation({
  id: "alloc-live",
  organizationId: "org-e2e-live",
  meetingId: meeting.id,
  decisionId: decision.id,
  projectId: "proj-e2e-live",
  managerId: manager.id,
  taskIds: ["task-live-parent"],
  decomposeTaskIds: ["task-live-parent"],
  assignedBy: boss.id,
}, tasks);

allocationSvc.approveAllocation("alloc-live", boss.id);
const activated = allocationSvc.activateAllocation("alloc-live", tasks);
assert(activated.decision === "ACTIVATED", "Allocation activation failed");

console.log("STEP 1: Allocation is ACTIVE");

const decomp = lifecycle.decomposeAllocatedTask("alloc-live", manager.id, parentTask, [
  { id: "sub-live-1", title: "Subtask UI Component", description: "UI component", priority: "high" },
], tasks);
assert(decomp.decision === "DECOMPOSED", "Decomposition failed");
const subtask = tasks.get("sub-live-1")!;

console.log("STEP 2: Parent task decomposed into governed subtask");

// ── Step 3: Governed Delegation ──────────────────────────────────────────────

const del = coordination.delegateSubtask("alloc-live", manager.id, subtask, worker.id, tasks);
assert(del.decision === "DELEGATED" && del.task?.assignedTo === worker.id, "Delegation failed");

console.log("STEP 3: Governed Manager → Worker delegation completed");

// ── Step 4: Worker sends progress update ──────────────────────────────────────

const prog = coordination.sendWorkerProgress(worker.id, manager.id, subtask.id, "alloc-live", "Component 75% complete", tasks);
assert(prog.decision === "SENT" && prog.message !== null, "Worker progress update failed");

console.log("STEP 4: Worker sent progress update via A2A");

// ── Step 5: Manager retrieves worker progress ────────────────────────────────

const mon = coordination.getWorkerProgress(manager.id, worker.id, "alloc-live", tasks);
assert(mon.decision === "OK" && mon.progressMessages.length >= 1, "Manager progress retrieval failed");
assert(mon.progressMessages[0].content === "Component 75% complete", "Unexpected progress message content");

console.log(`STEP 5: Manager retrieved progress update: '${mon.progressMessages[0].content}'`);

// ── Step 6: Worker reports blocker ────────────────────────────────────────────

const blockerRep = coordination.reportWorkerBlocker(worker.id, manager.id, subtask.id, "alloc-live", "3rd-party API authentication failed", tasks);
assert(blockerRep.decision === "REPORTED" && blockerRep.message !== null, "Blocker report failed");

console.log("STEP 6: Worker reported blocker to Manager via A2A");

// ── Step 7: Manager handles blocker (Recovery fails → Escalation) ──────────────

// First recovery attempt
const rec1 = coordination.handleBlocker("alloc-live", manager.id, tasks.get("sub-live-1")!, "3rd-party API auth failure", tasks);
assert(rec1.decision === "RECOVERED", "First recovery should succeed");

// Second recovery attempt (maxRetries = 1, so recovery fails → escalates)
const rec2 = coordination.handleBlocker("alloc-live", manager.id, tasks.get("sub-live-1")!, "Repeated API auth failure", tasks);
assert(rec2.decision === "ESCALATED" && rec2.escalation !== null, "Second recovery attempt should escalate to Boss");
const escalationRecord = rec2.escalation!.escalation!;


console.log("STEP 7: Manager handled blocker (Recovery exhausted → Escalation created)");

// ── Step 8: Boss receives escalation notification via A2A ─────────────────────

const bossNotifications = coordination.getBossEscalationNotifications(boss.id);
assert(bossNotifications.length >= 1, "Boss did not receive escalation notification");
assert(bossNotifications[0].toAgentId === boss.id, "Escalation notification targeted wrong agent");

console.log("STEP 8: Boss received escalation notification via A2A");

// ── Step 9: Boss approves escalation & applies intervention ──────────────────

const bossApproval = coordination.approveEscalation(boss.id, escalationRecord.id);
assert(bossApproval.decision === "APPROVED", "Boss escalation approval failed");

const interventionRes = coordination.applyBossIntervention(
  boss.id,
  escalationRecord.id,
  "intervention-live-e2e",
  "send_instruction",
  "Provide alternative OAuth proxy endpoint to worker"
);
assert(interventionRes.decision === "APPLIED" && interventionRes.message !== null, "Boss intervention failed");

console.log("STEP 9: Boss approved escalation and applied intervention");

// ── Step 10: Manager receives intervention notification via A2A ────────────────

const managerInterventions = coordination.getManagerInterventions(manager.id);
assert(managerInterventions.length >= 1, "Manager did not receive intervention message");
assert(managerInterventions[0].content.includes("OAuth proxy endpoint"), "Intervention instruction mismatch");

console.log(`STEP 10: Manager received intervention instruction: '${managerInterventions[0].content}'`);

// ── Step 11: Audit integrity verification ─────────────────────────────────────

assert(audit.verifyIntegrity(), "Audit ledger integrity check failed");
assert(audit.getByType("MANAGER_ALLOCATION_ACTIVATED").length === 1, "Expected audit event for allocation activation");

console.log("STEP 11: Audit ledger integrity verified");

console.log("\n── LIVE COORDINATION SUMMARY ────────────────────────────────────────────");
console.log("ACTIVE ALLOCATION → MANAGER DELEGATION → WORKER PROGRESS UPDATE → BLOCKER");
console.log("→ RECOVERY/ESCALATION → BOSS NOTIFIED → BOSS APPROVAL → BOSS INTERVENTION");
console.log("→ MANAGER RECEIVED INTERVENTION → AUDIT INTEGRITY: OK");
console.log("─────────────────────────────────────────────────────────────────────────");
console.log("\n✅ Boss ↔ Manager ↔ Worker Live Coordination integration test passed.");
