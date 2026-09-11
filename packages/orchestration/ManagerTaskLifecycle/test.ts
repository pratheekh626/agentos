/**
 * ManagerTaskLifecycle unit tests — production lifecycle
 *
 * Uses the real production ordering:
 *   PROPOSED → APPROVED → ACTIVE (with decomposeTaskIds skip)
 *   → coordinator decomposition → derived subtask authorization
 *   → dependency-aware governed delegation → worker execution
 *   → monitoring → recovery → escalation → intervention
 *
 * NO artificial status manipulation. The parent task is genuinely "queued"
 * throughout, and activateAllocation() skips it because it is listed in
 * allocation.decomposeTaskIds.
 */

import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";
import { OrganizationService } from "../../agents/Organization";
import { ConferenceRoomService } from "../../agents/ConferenceRoom";
import { AgentRuntime } from "../../agents/Runtime";
import { ExecutionService } from "../../agents/Execution";
import { EvidenceService } from "../../verification/Evidence";
import { AgentMessageService } from "../../messaging/AgentMessages";
import { TaskDispatcher } from "../TaskDispatcher";
import { DependencyManager } from "../Dependencies";
import { DelegationService } from "../Delegation";
import { Scheduler } from "../Scheduler";
import { RecoveryService } from "../Recovery";
import { EscalationService } from "../Escalation";
import { InterventionService } from "../Intervention";
import { ManagerAllocationService } from "../ManagerAllocation";
import { ManagerTaskLifecycle } from "./index";
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
import { AuditLedger } from "../../audit/AuditLedger";
import { AuditEventBridge } from "../../audit/EventBridge";
import { EventBus } from "../../messaging/EventBus";
import type { Task } from "../../core/Task";
import type { ExecutionEvents } from "../../agents/Execution";
import type { AgentRuntime as AgentRuntimeType } from "../../agents/Runtime";

// ── Agents ────────────────────────────────────────────────────────────────────

const registry = new AgentRegistry();
const boss        = createBoss("boss-001",           "Boss");
const manager     = createManager("manager-001",      "Manager A",      boss.id);
const otherMgr    = createManager("manager-002",      "Manager B",      boss.id);
const worker      = createWorker("worker-001",        "Worker A",       manager.id);
const otherWorker = createWorker("worker-002",        "Worker B",       otherMgr.id);
const pausedWorker= createWorker("worker-paused",     "Paused",         manager.id);
const offlineWorker=createWorker("worker-offline",    "Offline",        manager.id);
const busyWorker  = createWorker("worker-busy",       "Busy",           manager.id);

for (const a of [boss, manager, otherMgr, worker, otherWorker, pausedWorker, offlineWorker, busyWorker]) {
  registry.register(a);
}

// ── Infrastructure services ───────────────────────────────────────────────────

const messages  = new AgentMessageService();
const identity  = new IdentityService();
for (const a of [boss, manager, otherMgr, worker, otherWorker, pausedWorker, offlineWorker, busyWorker]) {
  identity.createIdentity({ agentId: a.id, role: a.role });
}
const wallet     = new WalletService();
const security   = new SecurityGateway(identity, new AccessControlService(identity), new RiskEngine(), new AnomalyDetectionService(), new KillSwitchService(identity, wallet));
const dispatcher = new TaskDispatcher(registry);
const depMgr     = new DependencyManager();
const delegation = new DelegationService(registry, new DelegationFirewall(new PermissionEngine(), new PolicyEngine()), new ApprovalEngine(), dispatcher, security);
const scheduler  = new Scheduler(registry, depMgr, delegation);
const runtime    = new AgentRuntime(registry, dispatcher, depMgr, delegation, scheduler, messages);
const recovery   = new RecoveryService(registry, dispatcher, delegation, messages, 1);
const escalation = new EscalationService(registry, new ApprovalEngine(), messages);
const interventions = new InterventionService(registry, messages, escalation);

// ── Organization ──────────────────────────────────────────────────────────────

const organization = new OrganizationService(registry);
organization.createOrganization("org-001", "AGENTOS", boss.id, "now");
organization.addManager(manager.id, "frontend");
organization.addManager(otherMgr.id, "backend");
organization.addWorker(worker.id, "frontend");
organization.addWorker(otherWorker.id, "backend");
organization.addWorker(pausedWorker.id, "frontend");
organization.addWorker(offlineWorker.id, "frontend");
organization.addWorker(busyWorker.id, "frontend");

registry.update(pausedWorker.id,  { status: "paused" });
registry.update(offlineWorker.id, { status: "offline" });
organization.updateAgentAvailability(pausedWorker.id,  "paused");
organization.updateAgentAvailability(offlineWorker.id, "offline");
organization.updateAgentAvailability(busyWorker.id,    "busy");

// ── Audit ─────────────────────────────────────────────────────────────────────

const audit = new AuditLedger();
const executionBus = new EventBus<ExecutionEvents>();

// ── Conference helper ─────────────────────────────────────────────────────────

const conference = new ConferenceRoomService(registry, messages);
let meetingSeq = 0;

function buildConference(projectId: string) {
  const id = `mtg-${++meetingSeq}`;
  const m = conference.createMeeting({ id, projectId, calledBy: boss.id, participants: [manager.id], agenda: "Allocate" });
  conference.startMeeting(m.id);
  const d = conference.createDecision({ id: `dec-${meetingSeq}`, meetingId: m.id, decidedBy: boss.id, decisionType: "ASSIGN_MANAGER", summary: "Manager owns work", taskIds: [], managerId: manager.id });
  conference.completeMeeting(m.id);
  return { meeting: m, decision: d };
}

// ── Allocation builder — REAL production path ─────────────────────────────────
//
// The parent task is "queued" + createdBy=manager.
// activateAllocation() skips it because its ID is in decomposeTaskIds.
// No status manipulation is performed anywhere.

let allocSeq = 0;

function buildActiveAllocation(
  planTaskId: string,
  extraTaskIds: string[] = [],
  extraTasks: Task[] = []
): {
  allocationSvc: ManagerAllocationService;
  lifecycle: ManagerTaskLifecycle;
  tasks: Map<string, Task>;
  planTask: Task;
  allocationId: string;
} {
  const allocId = `alloc-${++allocSeq}`;
  const { meeting, decision } = buildConference(`proj-${allocSeq}`);

  // Parent planning task owned by the manager, genuinely queued.
  const planTask: Task = {
    id: planTaskId,
    title: "Plan the work",
    description: "Decompose and plan implementation",
    assignedTo: null,
    createdBy: manager.id,   // manager owns it → Runtime.decomposeTask() will accept it
    status: "queued",        // genuinely queued — NOT artificially set to in_progress
    priority: "high",
    dependencies: [],
    budget: 0, spent: 0, createdAt: "now", updatedAt: "now",
  };

  const tasks = new Map<string, Task>([[planTaskId, planTask], ...extraTasks.map(t => [t.id, t] as [string, Task])]);

  // Mock runtime only for the activation step (schedules extraTaskIds, skips planTaskId).
  // The planTask ID is in decomposeTaskIds so activateAllocation never calls schedule() for it.
  const mockRuntime = {
    schedule(taskMap: Map<string, Task>) {
      const task = Array.from(taskMap.values()).find(t => extraTaskIds.includes(t.id));
      if (!task) throw new Error("Activation mock: no executable task found");
      return {
        decision: "SCHEDULED" as const,
        task: { ...task, assignedTo: worker.id, status: "assigned" as const },
        agent: registry.get(worker.id)!,
        approvalRequestId: null,
        reason: "activation",
      };
    },
  } as unknown as AgentRuntimeType;

  const allocationSvc = new ManagerAllocationService(registry, organization, conference, mockRuntime, messages);
  new AuditEventBridge(audit, executionBus, undefined, undefined, undefined, undefined, undefined, undefined, undefined, allocationSvc.events);

  const created = allocationSvc.createAllocation({
    id: allocId,
    organizationId: "org-001",
    meetingId: meeting.id,
    decisionId: decision.id,
    projectId: `proj-${allocSeq}`,
    managerId: manager.id,
    taskIds: [planTaskId, ...extraTaskIds],
    decomposeTaskIds: [planTaskId],          // Boss designates planTask for decomposition
    assignedBy: boss.id,
  }, tasks);
  if (created.decision !== "CREATED") throw new Error(`Allocation creation failed: ${created.reason}`);

  allocationSvc.approveAllocation(allocId, boss.id);

  const activated = allocationSvc.activateAllocation(allocId, tasks);
  if (activated.decision !== "ACTIVATED") throw new Error(`Allocation activation failed: ${activated.reason}`);

  // CRITICAL: planTask must still be unassigned (queued) after activation.
  const planTaskAfter = tasks.get(planTaskId)!;
  if (planTaskAfter.assignedTo !== null || planTaskAfter.status !== "queued") {
    throw new Error("PRODUCTION LIFECYCLE BROKEN: decomposeTask was scheduled to a worker during activation");
  }

  const lc = new ManagerTaskLifecycle(registry, organization, allocationSvc, runtime, depMgr, recovery, escalation);

  return { allocationSvc, lifecycle: lc, tasks, planTask: planTaskAfter, allocationId: allocId };
}

// ══════════════════════════════════════════════════════════════════════════════
//  TESTS 1–2: PROPOSED / APPROVED → no authority
// ══════════════════════════════════════════════════════════════════════════════

{
  const { meeting: em, decision: ed } = buildConference("proj-early");
  const earlyTask: Task = { id: "task-early", title: "Early", description: "", assignedTo: null, createdBy: manager.id, status: "queued", priority: "medium", dependencies: [], budget: 0, spent: 0, createdAt: "now", updatedAt: "now" };
  const earlyTasks = new Map<string, Task>([["task-early", earlyTask]]);
  const earlyMock = { schedule() { return { decision: "SCHEDULED" as const, task: { ...earlyTask, assignedTo: worker.id, status: "assigned" as const }, agent: registry.get(worker.id)!, approvalRequestId: null, reason: "ok" }; } } as unknown as AgentRuntimeType;
  const earlySvc = new ManagerAllocationService(registry, organization, conference, earlyMock, messages);
  earlySvc.createAllocation({ id: "alloc-early", organizationId: "org-001", meetingId: em.id, decisionId: ed.id, projectId: "proj-early", managerId: manager.id, taskIds: ["task-early"], decomposeTaskIds: ["task-early"], assignedBy: boss.id }, earlyTasks);
  const earlyLc = new ManagerTaskLifecycle(registry, organization, earlySvc, runtime, depMgr, recovery, escalation);

  // TEST 1: PROPOSED → no authority
  const proposed = earlyLc.decomposeAllocatedTask("alloc-early", manager.id, earlyTask, [], earlyTasks);
  if (proposed.decision !== "REJECTED" || !proposed.reason.includes("ACTIVE")) throw new Error("TEST 1 FAILED: PROPOSED should deny");

  earlySvc.approveAllocation("alloc-early", boss.id);

  // TEST 2: APPROVED → still no authority
  const approved = earlyLc.decomposeAllocatedTask("alloc-early", manager.id, earlyTask, [], earlyTasks);
  if (approved.decision !== "REJECTED" || !approved.reason.includes("ACTIVE")) throw new Error("TEST 2 FAILED: APPROVED should deny");
}
console.log("Tests 1–2 passed: PROPOSED/APPROVED deny authority");

// ══════════════════════════════════════════════════════════════════════════════
//  Build main allocation for tests 3–24
// ══════════════════════════════════════════════════════════════════════════════

registry.update(worker.id, { status: "idle" });
const { allocationSvc, lifecycle, tasks, planTask, allocationId } =
  buildActiveAllocation("task-plan-main");

// TEST 3: ACTIVE allocation exposes authorized parent
{
  const ids = lifecycle.getAuthorizedTaskIds(allocationId, manager.id, tasks);
  if (!ids.includes("task-plan-main")) throw new Error("TEST 3 FAILED: ACTIVE allocation should authorize task-plan-main");
}
console.log("Test 3 passed: ACTIVE allocation exposes authorized parent");

// TEST 4: Wrong manager rejected
{
  const r = lifecycle.decomposeAllocatedTask(allocationId, otherMgr.id, planTask, [{ id: "sub-x", title: "X", description: "x" }], tasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("does not own")) throw new Error("TEST 4 FAILED");
}
console.log("Test 4 passed: Wrong manager rejected");

// TEST 5: Task not in allocation → rejected
{
  const foreign: Task = { id: "task-foreign", title: "Foreign", description: "", assignedTo: null, createdBy: manager.id, status: "queued", priority: "low", dependencies: [], budget: 0, spent: 0, createdAt: "now", updatedAt: "now" };
  tasks.set("task-foreign", foreign);
  const r = lifecycle.decomposeAllocatedTask(allocationId, manager.id, foreign, [{ id: "sub-f", title: "F", description: "f" }], tasks);
  if (r.decision !== "REJECTED") throw new Error("TEST 5 FAILED: Foreign task should be rejected");
  tasks.delete("task-foreign");
}
console.log("Test 5 passed: Task not in allocation rejected");

// TEST 6 (NEW): Task in allocation.taskIds but NOT in decomposeTaskIds → rejected
{
  const { meeting: m6, decision: d6 } = buildConference("proj-6");
  const execTask: Task = { id: "task-exec-only", title: "Exec only", description: "", assignedTo: null, createdBy: boss.id, status: "queued", priority: "high", dependencies: [], budget: 0, spent: 0, createdAt: "now", updatedAt: "now" };
  const execTasks = new Map<string, Task>([["task-exec-only", execTask]]);
  const mockForExec = { schedule() { return { decision: "SCHEDULED" as const, task: { ...execTask, assignedTo: worker.id, status: "assigned" as const }, agent: registry.get(worker.id)!, approvalRequestId: null, reason: "ok" }; } } as unknown as AgentRuntimeType;
  const execSvc = new ManagerAllocationService(registry, organization, conference, mockForExec, messages);
  execSvc.createAllocation({ id: "alloc-exec-only", organizationId: "org-001", meetingId: m6.id, decisionId: d6.id, projectId: "proj-6", managerId: manager.id, taskIds: ["task-exec-only"], decomposeTaskIds: [], assignedBy: boss.id }, execTasks);
  execSvc.approveAllocation("alloc-exec-only", boss.id);
  execSvc.activateAllocation("alloc-exec-only", execTasks);
  registry.update(worker.id, { status: "idle" });
  const execLc = new ManagerTaskLifecycle(registry, organization, execSvc, runtime, depMgr, recovery, escalation);
  const r = execLc.decomposeAllocatedTask("alloc-exec-only", manager.id, execTasks.get("task-exec-only")!, [{ id: "sub-z", title: "Z", description: "z" }], execTasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("decomposeTaskIds")) throw new Error("TEST 6 FAILED: task not in decomposeTaskIds should be rejected");
}
console.log("Test 6 passed: Task not in decomposeTaskIds rejected");

// TEST 7: Authorized decomposition succeeds (real production path)
{
  const r = lifecycle.decomposeAllocatedTask(allocationId, manager.id, planTask, [
    { id: "sub-001", title: "Sub A", description: "Frontend component", priority: "high" },
    { id: "sub-002", title: "Sub B", description: "Backend API", priority: "medium", dependencies: ["sub-001"] },
    { id: "sub-recover", title: "Recover task", description: "Task for recovery test", priority: "high" },
  ], tasks);
  if (r.decision !== "DECOMPOSED" || r.subtasks.length !== 3) throw new Error(`TEST 7 FAILED: Expected DECOMPOSED with 3 subtasks, got ${r.decision}`);
  if (r.subtasks[1].dependencies[0] !== "sub-001") throw new Error("TEST 7 FAILED: Dependency not preserved");
  if (!tasks.has("sub-001") || !tasks.has("sub-002") || !tasks.has("sub-recover")) throw new Error("TEST 7 FAILED: Subtasks not in task map");
}
console.log("Test 7 passed: Authorized decomposition succeeds (real production path)");

// Verify planTask was NOT assigned to a worker at any point during production activation
{
  if (planTask.assignedTo !== null) throw new Error("PRODUCTION ORDERING VIOLATED: planTask was worker-assigned during activation");
  if (planTask.status !== "queued") throw new Error("PRODUCTION ORDERING VIOLATED: planTask status was changed during activation");
}
console.log("Production ordering verified: decompose task was never worker-assigned during activation");

// TEST 8: Derived subtasks are allocation-authorized
{
  const ids = lifecycle.getAuthorizedTaskIds(allocationId, manager.id, tasks);
  if (!ids.includes("sub-001") || !ids.includes("sub-002")) throw new Error("TEST 8 FAILED: Derived subtasks should be authorized");
}
console.log("Test 8 passed: Derived subtasks are allocation-authorized");

// TEST 9: Unrelated task cannot gain authorization
{
  const inject: Task = { id: "task-inject", title: "Inject", description: "", assignedTo: null, createdBy: manager.id, status: "queued", priority: "low", dependencies: [], budget: 0, spent: 0, createdAt: "now", updatedAt: "now" };
  tasks.set("task-inject", inject);
  const r = lifecycle.delegateAllocatedSubtask(allocationId, manager.id, inject, worker.id, tasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("not authorized")) throw new Error("TEST 9 FAILED: Unrelated task should be rejected");
  tasks.delete("task-inject");
}
console.log("Test 9 passed: Unrelated task cannot gain authorization");

// ══════════════════════════════════════════════════════════════════════════════
//  TESTS 10–16: Worker selection + dependency + governance
// ══════════════════════════════════════════════════════════════════════════════

const sub001 = tasks.get("sub-001")!;
const sub002 = tasks.get("sub-002")!;

// TEST 10: Worker from another manager rejected
{
  const r = lifecycle.delegateAllocatedSubtask(allocationId, manager.id, sub001, otherWorker.id, tasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("does not belong")) throw new Error("TEST 10 FAILED");
}
console.log("Test 10 passed: Cross-manager worker rejected");

// TEST 11: Paused worker rejected
{
  const r = lifecycle.delegateAllocatedSubtask(allocationId, manager.id, sub001, pausedWorker.id, tasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("unavailable")) throw new Error("TEST 11 FAILED");
}
console.log("Test 11 passed: Paused worker rejected");

// TEST 12: Offline worker rejected
{
  const r = lifecycle.delegateAllocatedSubtask(allocationId, manager.id, sub001, offlineWorker.id, tasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("unavailable")) throw new Error("TEST 12 FAILED");
}
console.log("Test 12 passed: Offline worker rejected");

// TEST 13: Max workload — put busyWorker at capacity by placing an active task in the map
{
  const busyTask: Task = {
    id: "busy-task-1",
    title: "Busy task", description: "",
    assignedTo: busyWorker.id, createdBy: manager.id,
    status: "in_progress",
    priority: "medium",
    dependencies: [], budget: 0, spent: 0, createdAt: "now", updatedAt: "now",
  };
  tasks.set("busy-task-1", busyTask);
  // busyWorker now has currentTaskCount=1, maxConcurrentTasks=1 → at capacity
  const r = lifecycle.delegateAllocatedSubtask(allocationId, manager.id, sub001, busyWorker.id, tasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("maximum concurrent")) throw new Error(`TEST 13 FAILED: Busy worker should be rejected, got ${r.decision}: ${r.reason}`);
  tasks.delete("busy-task-1");
}
console.log("Test 13 passed: Max workload respected via OrganizationService");

// ── DEPENDENCY READINESS TESTS ────────────────────────────────────────────────

// TEST DEP-A: sub-002 depends on sub-001; sub-001 is still "queued" → delegation blocked
{
  const r = lifecycle.delegateAllocatedSubtask(allocationId, manager.id, sub002, worker.id, tasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("dependencies are not yet completed")) {
    throw new Error(`TEST DEP-A FAILED: Expected dependency-blocked rejection, got ${r.decision}: ${r.reason}`);
  }
}
console.log("Test DEP-A passed: Dependent task blocked when dependency is queued");

// TEST DEP-B: advance sub-001 to status="verification" → still blocked (not "completed")
{
  const sub001Assigned = { ...sub001, assignedTo: worker.id, status: "assigned" as const };
  const sub001Started  = { ...sub001Assigned, status: "in_progress" as const };
  const sub001Verified = { ...sub001Started, status: "verification" as const };
  tasks.set("sub-001", sub001Verified);

  const r = lifecycle.delegateAllocatedSubtask(allocationId, manager.id, sub002, worker.id, tasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("dependencies are not yet completed")) {
    throw new Error(`TEST DEP-B FAILED: verification status should still block delegation, got ${r.decision}: ${r.reason}`);
  }
  // Leave sub-001 in verification state for next test
}
console.log("Test DEP-B passed: verification dependency still blocks delegation");

// TEST DEP-C: finalize sub-001 from verification status to "completed" via Runtime -> delegation of sub-002 succeeds
{
  const sub001Assigned = { ...sub001, assignedTo: worker.id, status: "assigned" as const };
  const sub001Started = runtime.startTask(sub001Assigned);
  const sub001Verified = runtime.completeTask(sub001Started);
  const sub001Completed = runtime.finalizeTask(sub001Verified);
  tasks.set("sub-001", sub001Completed);


  registry.update(worker.id, { status: "idle" });
  const r = lifecycle.delegateAllocatedSubtask(allocationId, manager.id, sub002, worker.id, tasks);
  if (r.decision !== "DELEGATED" || r.task?.assignedTo !== worker.id) {
    throw new Error(`TEST DEP-C FAILED: Expected DELEGATED with completed dep, got ${r.decision}: ${r.reason}`);
  }
  if (!r.message || r.message.type !== "delegation") {
    throw new Error("TEST DEP-C FAILED: Missing delegation A2A message");
  }
  tasks.set("sub-002", r.task!);
  // Reset sub-001 to queued so subsequent tests can run independently
  tasks.set("sub-001", sub001);
  tasks.set("sub-002", sub002);
}
console.log("Test DEP-C passed: Genuinely completed dependency allows delegation");

// ── Continue with sub-001 delegation ─────────────────────────────────────────
// Restore sub-001 to queued so it can be delegated independently
tasks.set("sub-001", sub001);
registry.update(worker.id, { status: "idle" });

// TESTS 14–15: Worker assignment uses Runtime.assignSubtask (not TaskDispatcher directly)
{
  const r = lifecycle.delegateAllocatedSubtask(allocationId, manager.id, sub001, worker.id, tasks);
  if (r.decision !== "DELEGATED" || r.task?.assignedTo !== worker.id) throw new Error(`TEST 14 FAILED: ${r.decision} ${r.reason}`);
  if (!r.message || r.message.type !== "delegation") throw new Error("TEST 15 FAILED: Missing A2A delegation message from Runtime.assignSubtask");
  if (tasks.get("sub-001")?.assignedTo !== worker.id) throw new Error("TEST 14 FAILED: Task map not updated");
}
console.log("Tests 14–15 passed: Runtime.assignSubtask used, delegation A2A message emitted");

// TEST 16: Governance enforced — high risk causes denial
{
  const r = lifecycle.delegateAllocatedSubtask(allocationId, manager.id, sub002, worker.id, tasks, 80);
  if (r.decision !== "REJECTED") throw new Error("TEST 16 FAILED: High risk should cause governance denial");
}
console.log("Test 16 passed: Governance/security remains enforced");

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 17: Worker execution reaches existing ExecutionService
// ══════════════════════════════════════════════════════════════════════════════

{
  const assignedSub001 = tasks.get("sub-001")!;
  const started = runtime.startTask(assignedSub001);
  tasks.set("sub-001", started);

  const evidenceSvc = new EvidenceService();
  const executionSvc = new ExecutionService(evidenceSvc);
  executionSvc.start(started, registry.get(worker.id)!);
  const rec = executionSvc.execute(started, registry.get(worker.id)!, {
    success: true,
    output: "Component implemented",
    evidence: { type: "test_result", title: "Test", description: "All pass", reference: "ref-001" },
  });
  if (rec.status !== "completed" || !rec.evidenceId) throw new Error("TEST 17 FAILED");
  if (!evidenceSvc.get(rec.evidenceId!)) throw new Error("TEST 17 FAILED: Evidence not stored");

  const completed = runtime.completeTask(started);
  tasks.set("sub-001", completed);
}
console.log("Test 17 passed: Worker execution reaches existing ExecutionService");

// ══════════════════════════════════════════════════════════════════════════════
//  TESTS 18–19: Monitoring
// ══════════════════════════════════════════════════════════════════════════════

runtime.sendMessage({ fromAgentId: worker.id, toAgentId: manager.id, type: "status_update", subject: "progress", content: "50% done", taskId: "sub-001" });

// TEST 18: Monitoring within allocation scope
{
  const r = lifecycle.monitorWorker(allocationId, manager.id, worker.id, tasks);
  if (r.decision !== "OK") throw new Error(`TEST 18 FAILED: ${r.reason}`);
  if (r.workerStatus === null) throw new Error("TEST 18 FAILED: workerStatus missing");
}
console.log("Test 18 passed: Monitoring is allocation-scoped");

// TEST 19: Another manager's worker rejected
{
  const r = lifecycle.monitorWorker(allocationId, manager.id, otherWorker.id, tasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("not managed")) throw new Error("TEST 19 FAILED");
}
console.log("Test 19 passed: Cross-manager monitoring rejected");

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 20: Blocker uses existing RecoveryService
// ══════════════════════════════════════════════════════════════════════════════

{
  const recoverTask = tasks.get("sub-recover")!;
  const assignedRecover = { ...recoverTask, assignedTo: worker.id, status: "assigned" as const };
  tasks.set("sub-recover", assignedRecover);
  registry.update(worker.id, { status: "idle" });

  const r = lifecycle.handleBlocker(allocationId, manager.id, assignedRecover, "Worker process failed", tasks);
  if (r.decision !== "RECOVERED" && r.decision !== "ESCALATED") throw new Error(`TEST 20 FAILED: ${r.decision} ${r.reason}`);
  if (!r.recovery) throw new Error("TEST 20 FAILED: No recovery result");
}

console.log("Test 20 passed: Blocker routes through existing RecoveryService");

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 21: Manager escalation reaches correct Boss
// ══════════════════════════════════════════════════════════════════════════════

{
  const r = lifecycle.escalateTowardsBoss(allocationId, manager.id, "task-plan-main", "Cannot resolve unilaterally");
  if (r.decision !== "PENDING") throw new Error(`TEST 21 FAILED: ${r.decision} ${r.reason}`);
  if (r.escalation?.bossId !== boss.id) throw new Error("TEST 21 FAILED: Wrong boss targeted");
  if (r.message?.toAgentId !== boss.id) throw new Error("TEST 21 FAILED: Boss not notified");
}
console.log("Test 21 passed: Manager escalation reaches correct Boss");

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 22: Boss intervention reaches correct Manager
// ══════════════════════════════════════════════════════════════════════════════

{
  // Find the escalation that was just created
  const escalBossMessages = messages.getByAgent(boss.id).filter(m => m.type === "approval_request");
  const lastEscal = escalBossMessages[escalBossMessages.length - 1];
  if (!lastEscal) throw new Error("TEST 22 SETUP: No approval_request found");

  // Probe escalation records (the id is deterministic from the coordinator)
  let taskEscalation = escalation.get(`escalation-${allocationId}-task-plan-main-1`);
  if (!taskEscalation) taskEscalation = escalation.get(`escalation-${allocationId}-task-plan-main-2`);
  if (!taskEscalation) throw new Error("TEST 22 SETUP: Escalation record not found");

  escalation.approveEscalation(taskEscalation.id, boss.id);

  const intervention = interventions.intervene({
    id: "intervention-test-001",
    escalationId: taskEscalation.id,
    bossId: boss.id,
    action: "send_instruction",
    instruction: "Use the approved fallback approach",
  });
  if (intervention.decision !== "APPLIED") throw new Error(`TEST 22 FAILED: ${intervention.reason}`);
  if (intervention.message?.toAgentId !== manager.id) throw new Error("TEST 22 FAILED: Wrong manager notified");
}
console.log("Test 22 passed: Boss intervention reaches correct Manager");

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 23: A2A messages are correct
// ══════════════════════════════════════════════════════════════════════════════

{
  const managerMsgs = messages.getByAgent(manager.id);
  if (!managerMsgs.some(m => m.type === "delegation"))      throw new Error("TEST 23 FAILED: Missing delegation message");
  if (!managerMsgs.some(m => m.type === "status_update"))   throw new Error("TEST 23 FAILED: Missing status_update");
  if (!managerMsgs.some(m => m.type === "notification"))    throw new Error("TEST 23 FAILED: Missing notification");
  if (!managerMsgs.some(m => m.type === "response"))        throw new Error("TEST 23 FAILED: Missing escalation response");
}
console.log("Test 23 passed: A2A messages are correct");

// ══════════════════════════════════════════════════════════════════════════════
//  TEST 24: Existing audit behavior preserved
// ══════════════════════════════════════════════════════════════════════════════

{
  if (audit.getByType("MANAGER_ALLOCATION_CREATED").length === 0) throw new Error("TEST 24 FAILED: Missing CREATED audit");
  if (audit.getByType("MANAGER_ALLOCATION_APPROVED").length === 0) throw new Error("TEST 24 FAILED: Missing APPROVED audit");
  if (audit.getByType("MANAGER_ALLOCATION_ACTIVATED").length === 0) throw new Error("TEST 24 FAILED: Missing ACTIVATED audit");
  if (!audit.verifyIntegrity()) throw new Error("TEST 24 FAILED: Audit integrity failed");
}
console.log("Test 24 passed: Existing audit behavior preserved");

// ── Edge cases ────────────────────────────────────────────────────────────────

// Wrong manager cannot escalate
{
  const r = lifecycle.escalateTowardsBoss(allocationId, otherMgr.id, "task-plan-main", "test");
  if (r.decision !== "DENY" || !r.reason.includes("does not own")) throw new Error("Edge: wrong manager escalate should fail");
}
// Non-existent allocation
{
  const r = lifecycle.decomposeAllocatedTask("missing", manager.id, planTask, [], tasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("not found")) throw new Error("Edge: missing allocation should fail");
}
// Worker with no allocation tasks cannot be monitored
{
  const freshWorker = createWorker("worker-fresh", "Fresh", manager.id);
  registry.register(freshWorker);
  identity.createIdentity({ agentId: freshWorker.id, role: "worker" });
  organization.addWorker(freshWorker.id, "frontend");
  const r = lifecycle.monitorWorker(allocationId, manager.id, freshWorker.id, tasks);
  if (r.decision !== "REJECTED" || !r.reason.includes("no tasks")) throw new Error("Edge: fresh worker monitoring should fail");
}
console.log("Edge cases passed.");

console.log("\n✅ All ManagerTaskLifecycle unit tests passed (production lifecycle).");
