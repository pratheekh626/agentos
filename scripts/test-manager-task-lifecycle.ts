/**
 * Integration test: Governed Manager → Worker Task Lifecycle (production path)
 *
 * Exercises the complete production ordering WITHOUT any artificial status
 * manipulation. The parent task is genuinely "queued" throughout; activation
 * skips it because it is listed in allocation.decomposeTaskIds.
 *
 * Flow:
 *   PROPOSED → APPROVED → ACTIVE
 *   → coordinator decomposition (parent remains unassigned after activation)
 *   → derived subtask authorization
 *   → dependency-aware governed delegation
 *   → ExecutionService worker execution + evidence
 *   → manager monitoring
 *   → RecoveryService (blocker)
 *   → EscalationService (manager → Boss)
 *   → InterventionService (Boss → Manager)
 *   → AuditLedger integrity
 */

import { AgentRegistry } from "../packages/agents/AgentRegistry";
import { createBoss } from "../packages/agents/Boss";
import { createManager } from "../packages/agents/Managers";
import { createWorker } from "../packages/agents/Workers";
import { OrganizationService } from "../packages/agents/Organization";
import { ConferenceRoomService } from "../packages/agents/ConferenceRoom";
import { AgentRuntime } from "../packages/agents/Runtime";
import { ExecutionService } from "../packages/agents/Execution";
import { EvidenceService } from "../packages/verification/Evidence";
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
import type { AgentRuntime as AgentRuntimeType } from "../packages/agents/Runtime";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── Agents ────────────────────────────────────────────────────────────────────

const registry = new AgentRegistry();
const boss     = createBoss("boss-e2e",        "Boss");
const manager  = createManager("manager-e2e",  "Engineering Manager", boss.id);
const workerA  = createWorker("worker-e2e-a",  "Worker A",            manager.id);
const workerB  = createWorker("worker-e2e-b",  "Worker B",            manager.id);

for (const a of [boss, manager, workerA, workerB]) registry.register(a);

// ── Infrastructure ────────────────────────────────────────────────────────────

const messages  = new AgentMessageService();
const identity  = new IdentityService();
for (const a of [boss, manager, workerA, workerB]) identity.createIdentity({ agentId: a.id, role: a.role });

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

// ── Evidence + Execution ──────────────────────────────────────────────────────

const evidenceSvc  = new EvidenceService();
const executionSvc = new ExecutionService(evidenceSvc);

// ── Audit ─────────────────────────────────────────────────────────────────────

const audit = new AuditLedger();
const executionBus = new EventBus<ExecutionEvents>();
executionSvc.events.on("execution.evidence_created", (evidence) => {
  executionBus.emit("execution.evidence_created", evidence);
});

// ── Organization ──────────────────────────────────────────────────────────────

const organization = new OrganizationService(registry);
organization.createOrganization("org-e2e", "AGENTOS", boss.id, "2026-09-11T00:00:00.000Z");
organization.addManager(manager.id, "frontend");
organization.addWorker(workerA.id, "frontend");
organization.addWorker(workerB.id, "frontend");

// ── Conference: Boss calls meeting + creates decision ─────────────────────────

const conference = new ConferenceRoomService(registry, messages);
const meeting = conference.createMeeting({
  id: "meeting-e2e-lifecycle",
  projectId: "project-e2e-lifecycle",
  calledBy: boss.id,
  participants: [manager.id],
  agenda: "Allocate frontend implementation to manager",
  createdAt: "2026-09-11T00:01:00.000Z",
});
conference.startMeeting(meeting.id);
const decision = conference.createDecision({
  id: "decision-e2e-lifecycle",
  meetingId: meeting.id,
  decidedBy: boss.id,
  decisionType: "ASSIGN_MANAGER",
  summary: "Manager owns frontend implementation responsibility",
  taskIds: [],
  managerId: manager.id,
  createdAt: "2026-09-11T00:01:30.000Z",
});
conference.completeMeeting(meeting.id);

// ── Parent task — genuinely queued, owned by the manager ─────────────────────
//
// The Boss is granting the Manager responsibility to break this down.
// createdBy = manager.id so Runtime.decomposeTask() accepts it.
// status    = "queued"   — NO artificial manipulation.
//
const parentTask: Task = {
  id:          "task-e2e-parent",
  title:       "Implement frontend module",
  description: "Complete the frontend implementation",
  assignedTo:  null,
  createdBy:   manager.id,
  status:      "queued",
  priority:    "high",
  dependencies: [],
  budget: 0, spent: 0,
  createdAt: "2026-09-11T00:02:00.000Z",
  updatedAt: "2026-09-11T00:02:00.000Z",
};

const tasks = new Map<string, Task>([["task-e2e-parent", parentTask]]);

// ── Allocation PROPOSED → APPROVED → ACTIVE ───────────────────────────────────
//
// decomposeTaskIds: ["task-e2e-parent"]
//   → activateAllocation() skips this task (Boss designated it for decomposition)
//   → parentTask remains "queued" + assignedTo=null after activation
//
// There are no other "queued" executable tasks, so the mock runtime is never
// called during activation.  We still pass one for type completeness.

import { VerificationService } from "../packages/verification/Evidence/../Verification";
import { QAService } from "../packages/verification/Evidence/../QA";
import { ProofToPayService } from "../packages/verification/Evidence/../ProofToPay";
import { ProjectVerificationService } from "../packages/orchestration/ProjectVerification";
import { ProjectQAService } from "../packages/orchestration/ProjectQA";
import { ProjectProofToPayService } from "../packages/orchestration/ProjectProofToPay";
import { BudgetService } from "../packages/economy/Budget";
import { TransactionService } from "../packages/economy/Transactions";
import { CreditEngine } from "../packages/economy/CreditEngine";

const allocationSvc = new ManagerAllocationService(
  registry, organization, conference, runtime, messages
);

const allocationAuditBridge = new AuditEventBridge(
  audit, executionBus,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  allocationSvc.events
);

const created = allocationSvc.createAllocation({
  id:             "alloc-e2e-lifecycle",
  organizationId: "org-e2e",
  meetingId:      meeting.id,
  decisionId:     decision.id,
  projectId:      "project-e2e-lifecycle",
  managerId:      manager.id,
  taskIds:        ["task-e2e-parent"],
  decomposeTaskIds: ["task-e2e-parent"],   // Boss explicitly designates for decomposition
  assignedBy:     boss.id,
  createdAt:      "2026-09-11T00:03:00.000Z",
}, tasks);
assert(created.decision === "CREATED", `Allocation creation failed: ${created.reason}`);

const approved = allocationSvc.approveAllocation("alloc-e2e-lifecycle", boss.id);
assert(approved.decision === "APPROVED", `Allocation approval failed: ${approved.reason}`);

const activated = allocationSvc.activateAllocation("alloc-e2e-lifecycle", tasks);
assert(activated.decision === "ACTIVATED", `Allocation activation failed: ${activated.reason}`);
assert(activated.scheduledTasks.length === 0, "Activation should schedule nothing — parentTask is in decomposeTaskIds");

// CRITICAL production ordering check: parentTask must still be unassigned and queued.
const parentAfterActivation = tasks.get("task-e2e-parent")!;
assert(parentAfterActivation.assignedTo === null, "PRODUCTION ORDERING VIOLATED: parentTask was worker-assigned during activation");
assert(parentAfterActivation.status === "queued",  "PRODUCTION ORDERING VIOLATED: parentTask status changed during activation");

console.log("ALLOCATION ACTIVE (parentTask is unassigned — ready for manager decomposition)");

// ── Lifecycle coordinator ─────────────────────────────────────────────────────

const lifecycle = new ManagerTaskLifecycle(
  registry, organization, allocationSvc, runtime, depMgr, recovery, escalation
);

// ── STEP 1: Manager decomposes the parent task (before any worker assignment) ─

const decomposed = lifecycle.decomposeAllocatedTask(
  "alloc-e2e-lifecycle",
  manager.id,
  parentAfterActivation,
  [
    {
      id:          "sub-e2e-ui",
      title:       "Build UI components",
      description: "Implement the React UI components",
      priority:    "high",
    },
    {
      id:           "sub-e2e-api",
      title:        "Integrate API layer",
      description:  "Connect frontend to backend APIs",
      priority:     "high",
      dependencies: ["sub-e2e-ui"],   // API depends on UI completion
    },
  ],
  tasks
);

assert(decomposed.decision === "DECOMPOSED", `Decomposition failed: ${decomposed.reason}`);
assert(decomposed.subtasks.length === 2, "Expected 2 subtasks");
assert(tasks.has("sub-e2e-ui"),  "sub-e2e-ui not in task map");
assert(tasks.has("sub-e2e-api"), "sub-e2e-api not in task map");
assert(decomposed.subtasks[1].dependencies[0] === "sub-e2e-ui", "Dependency chain not preserved");

console.log("STEP 1: Parent task decomposed BEFORE any worker assignment");
console.log(`  Subtask A: ${decomposed.subtasks[0].title}`);
console.log(`  Subtask B: ${decomposed.subtasks[1].title} (depends on A)`);

// ── STEP 2: Verify derived subtask authorization ───────────────────────────────

const authorizedIds = lifecycle.getAuthorizedTaskIds("alloc-e2e-lifecycle", manager.id, tasks);
assert(authorizedIds.includes("task-e2e-parent"), "Parent should remain authorized");
assert(authorizedIds.includes("sub-e2e-ui"),      "sub-e2e-ui should be derived-authorized");
assert(authorizedIds.includes("sub-e2e-api"),      "sub-e2e-api should be derived-authorized");

// Verify unrelated task cannot sneak in
const unrelated: Task = { id: "task-unrelated", title: "Unrelated", description: "", assignedTo: null, createdBy: manager.id, status: "queued", priority: "low", dependencies: [], budget: 0, spent: 0, createdAt: "now", updatedAt: "now" };
tasks.set("task-unrelated", unrelated);
const unrelatedResult = lifecycle.delegateAllocatedSubtask("alloc-e2e-lifecycle", manager.id, unrelated, workerA.id, tasks);
assert(unrelatedResult.decision === "REJECTED", "Unrelated task must be rejected");
tasks.delete("task-unrelated");

console.log("STEP 2: Derived subtask authorization verified; unrelated task rejected");

// ── STEP 3: Dependency check — sub-e2e-api blocked until sub-e2e-ui completes ─

const subUI  = tasks.get("sub-e2e-ui")!;
const subAPI = tasks.get("sub-e2e-api")!;

// sub-e2e-api depends on sub-e2e-ui which is still "queued" → must be blocked
const blockedByQueued = lifecycle.delegateAllocatedSubtask("alloc-e2e-lifecycle", manager.id, subAPI, workerB.id, tasks);
assert(blockedByQueued.decision === "REJECTED" && blockedByQueued.reason.includes("dependencies"), "DEPENDENCY CHECK FAILED: api should be blocked while ui is queued");

// Delegate sub-e2e-ui to workerA first
const delegateUI = lifecycle.delegateAllocatedSubtask("alloc-e2e-lifecycle", manager.id, subUI, workerA.id, tasks);
assert(delegateUI.decision === "DELEGATED", `Delegation to workerA failed: ${delegateUI.reason}`);
assert(delegateUI.task?.assignedTo === workerA.id, "Task not assigned to workerA");
assert(delegateUI.message?.type === "delegation",   "Missing delegation A2A message");

// After delegation, sub-e2e-api is still blocked (ui is now "assigned", not "completed")
const subUIAssigned = tasks.get("sub-e2e-ui")!;
const blockedByAssigned = lifecycle.delegateAllocatedSubtask("alloc-e2e-lifecycle", manager.id, subAPI, workerB.id, tasks);
assert(blockedByAssigned.decision === "REJECTED" && blockedByAssigned.reason.includes("dependencies"), "DEPENDENCY CHECK FAILED: api should be blocked while ui is assigned");

console.log("STEP 3: Dependency enforcement verified (queued → assigned → still blocked)");

// ── STEP 4: Worker A executes sub-e2e-ui ──────────────────────────────────────

const startedUI = runtime.startTask(subUIAssigned);
tasks.set("sub-e2e-ui", startedUI);

// Worker sends progress update
runtime.sendMessage({ fromAgentId: workerA.id, toAgentId: manager.id, type: "status_update", subject: "UI progress", content: "60% done", taskId: "sub-e2e-ui", priority: "medium" });

executionSvc.start(startedUI, registry.get(workerA.id)!);
const execRecord = executionSvc.execute(startedUI, registry.get(workerA.id)!, {
  success: true,
  output: "UI components implemented and tested",
  evidence: { type: "test_result", title: "UI test suite", description: "All tests pass", reference: "ui-tests-001" },
});
assert(execRecord.status === "completed", "Worker execution did not complete");
assert(execRecord.evidenceId !== null,    "No evidence produced");
assert(evidenceSvc.get(execRecord.evidenceId!), "Evidence not stored");

// completeTask → status becomes "verification" (not "completed")
const verifiedUI = runtime.completeTask(startedUI);
tasks.set("sub-e2e-ui", verifiedUI);
assert(verifiedUI.status === "verification", "Expected verification status after completeTask");

console.log("STEP 4: Worker A executed via ExecutionService");
console.log(`  Evidence ID: ${execRecord.evidenceId}`);
console.log(`  sub-e2e-ui status: ${verifiedUI.status}`);

// ── STEP 5: Dependency check — "verification" is still NOT "completed" ─────────

// sub-e2e-api should still be blocked — ui is in "verification", not "completed"
const blockedByVerification = lifecycle.delegateAllocatedSubtask("alloc-e2e-lifecycle", manager.id, subAPI, workerB.id, tasks);
assert(
  blockedByVerification.decision === "REJECTED" && blockedByVerification.reason.includes("dependencies"),
  `DEPENDENCY CHECK FAILED: api should be blocked while ui is in verification. Got: ${blockedByVerification.decision}: ${blockedByVerification.reason}`
);

console.log("STEP 5: Dependency check — 'verification' still blocks delegation (not 'completed')");

// ── STEP 6: Execute full Verification → QA → ProofToPay lifecycle ─────────────

const verificationSvc = new VerificationService();
const projectVerification = new ProjectVerificationService(registry, evidenceSvc, verificationSvc);
const verReq = projectVerification.request(execRecord, boss, "verification-e2e-ui");
assert(verReq.decision === "CREATED", "Verification request failed");
const verPass = projectVerification.pass("verification-e2e-ui", boss, 95, "UI verified successfully");
assert(verPass.decision === "PASSED", "Verification pass failed");

const qaSvc = new QAService();
const projectQA = new ProjectQAService(registry, evidenceSvc, qaSvc);
const qaReq = projectQA.request(verPass.verification!, boss, "qa-e2e-ui", ["Responsive check", "Unit tests"]);
assert(qaReq.decision === "CREATED", "QA request failed");
const qaPass = projectQA.pass("qa-e2e-ui", boss, 98);
assert(qaPass.decision === "PASSED", "QA pass failed");

const budgetSvc = new BudgetService();
budgetSvc.createBudget("budget-e2e-lifecycle", workerA.id, 1000, 600);
wallet.createWallet(workerA.id, 1000, 2000, 500);

const creditEngine = new CreditEngine(
  new PermissionEngine(),
  new PolicyEngine(),
  wallet,
  budgetSvc,
  new TransactionService(),
  security
);
const proofToPaySvc = new ProofToPayService(evidenceSvc, verificationSvc, qaSvc, creditEngine);
const projectProofToPay = new ProjectProofToPayService(evidenceSvc, proofToPaySvc);

const payment = projectProofToPay.pay(
  execRecord,
  verPass.verification!,
  qaPass.qa!,
  {
    id: "payment-e2e-ui",
    agent: registry.get(workerA.id)!,
    taskId: "sub-e2e-ui",
    amount: 100,
    reason: "UI implementation verified and QA passed",
    riskScore: 10,
    budgetId: "budget-e2e-lifecycle",
  }
);
assert(payment.decision === "PAID", "Payment release failed");

// Transition task to completed via runtime.finalizeTask()
const completedUI = runtime.finalizeTask(verifiedUI);
tasks.set("sub-e2e-ui", completedUI);
assert(completedUI.status === "completed", "Task did not transition to completed");

// Now sub-e2e-api should be unblocked
const delegateAPI = lifecycle.delegateAllocatedSubtask("alloc-e2e-lifecycle", manager.id, subAPI, workerB.id, tasks);
assert(delegateAPI.decision === "DELEGATED", `API delegation failed: ${delegateAPI.reason}`);
assert(delegateAPI.task?.assignedTo === workerB.id, "API task not assigned to workerB");


console.log(`STEP 6: sub-e2e-api delegated to ${workerB.name} after dependency completed`);

// ── STEP 7: Manager monitors workerA ──────────────────────────────────────────

// workerA has sub-e2e-ui (completed) in the allocation tasks
const monitorResult = lifecycle.monitorWorker("alloc-e2e-lifecycle", manager.id, workerA.id, tasks);
assert(monitorResult.decision === "OK", `Monitoring failed: ${monitorResult.reason}`);
assert(monitorResult.progressMessages.length >= 1, "Expected at least one progress message");

console.log("STEP 7: Manager monitoring succeeded");
console.log(`  Worker status: ${monitorResult.workerStatus}`);
console.log(`  Progress messages: ${monitorResult.progressMessages.length}`);

// ── STEP 8: Blocker on sub-e2e-api → RecoveryService ─────────────────────────

const assignedSubAPI = tasks.get("sub-e2e-api")!;
const blockerResult = lifecycle.handleBlocker(
  "alloc-e2e-lifecycle", manager.id, assignedSubAPI, "API integration failed", tasks
);
assert(
  blockerResult.decision === "RECOVERED" || blockerResult.decision === "ESCALATED",
  `Blocker handling failed: ${blockerResult.decision} — ${blockerResult.reason}`
);
assert(blockerResult.recovery !== null, "Recovery result should be present");

console.log(`STEP 8: Blocker handled via RecoveryService — ${blockerResult.decision}`);
if (blockerResult.recovery?.recovery) {
  console.log(`  Recovery action: ${blockerResult.recovery.recovery.action}`);
}

// ── STEP 9: Manager escalates to Boss ─────────────────────────────────────────

const escalateResult = lifecycle.escalateTowardsBoss(
  "alloc-e2e-lifecycle", manager.id, "task-e2e-parent",
  "Project scope requires Boss decision"
);
assert(escalateResult.decision === "PENDING",            `Escalation failed: ${escalateResult.reason}`);
assert(escalateResult.escalation?.bossId === boss.id,    "Escalation targets wrong boss");
assert(escalateResult.message?.toAgentId === boss.id,    "Boss did not receive escalation message");

console.log("STEP 9: Escalation submitted to Boss via EscalationService");

// ── STEP 10: Boss approves + applies intervention ─────────────────────────────

const escalationId = escalateResult.escalation!.id;
const bossApproval = escalation.approveEscalation(escalationId, boss.id);
assert(bossApproval.decision === "APPROVED",                     "Boss approval failed");
assert(bossApproval.message?.toAgentId === manager.id,           "Approval notification not sent to manager");

const intervention = interventions.intervene({
  id: "intervention-e2e-001",
  escalationId,
  bossId: boss.id,
  action: "send_instruction",
  instruction: "Use the pre-approved fallback API approach",
});
assert(intervention.decision === "APPLIED",                      `Intervention failed: ${intervention.reason}`);
assert(intervention.message?.toAgentId === manager.id,           "Intervention not delivered to manager");

console.log("STEP 10: Boss intervention applied and manager notified via InterventionService");

// ── STEP 11: Audit integrity ──────────────────────────────────────────────────

assert(audit.getByType("MANAGER_ALLOCATION_CREATED").length >= 1,  "Missing CREATED audit");
assert(audit.getByType("MANAGER_ALLOCATION_APPROVED").length >= 1,  "Missing APPROVED audit");
assert(audit.getByType("MANAGER_ALLOCATION_ACTIVATED").length >= 1, "Missing ACTIVATED audit");
assert(audit.verifyIntegrity(),                                      "Audit ledger integrity failed");

console.log("STEP 11: Audit ledger integrity verified");
console.log(`  Total audit events: ${audit.count()}`);

// ── Summary ───────────────────────────────────────────────────────────────────

const totalMessages = messages.getAll().length;

console.log("\n── LIFECYCLE SUMMARY ────────────────────────────────────────────────────");
console.log("PROPOSED → APPROVED → ACTIVE (parentTask NOT scheduled to worker)");
console.log("PARENT TASK DECOMPOSED via Manager authority (decomposeTaskIds)");
console.log("DERIVED SUBTASKS AUTHORIZED (coordinator-owned)");
console.log("DEPENDENCY ENFORCEMENT: queued → blocked; assigned → blocked; verification → blocked; completed → unblocked");
console.log(`SUBTASK A (sub-e2e-ui) → ${workerA.name}  via Runtime.assignSubtask`);
console.log(`SUBTASK B (sub-e2e-api)→ ${workerB.name} via Runtime.assignSubtask (after dep completed)`);
console.log("WORKER A EXECUTED via ExecutionService + EvidenceService");
console.log("WORKER A MONITORED via Runtime.getWorkerStatus/Tasks/ProgressUpdates");
console.log(`BLOCKER → RecoveryService → ${blockerResult.decision}`);
console.log("ESCALATION → EscalationService → Boss");
console.log("BOSS INTERVENTION → InterventionService → Manager");
console.log(`A2A MESSAGES: ${totalMessages}`);
console.log(`AUDIT EVENTS: ${audit.count()} (integrity: OK)`);
console.log("─────────────────────────────────────────────────────────────────────────");

allocationAuditBridge.disconnect();

console.log("\n✅ Manager task lifecycle integration test passed (production ordering).");
