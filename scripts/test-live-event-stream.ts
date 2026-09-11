/**
 * Integration Test: Governed Live Event Stream
 *
 * Proves that real backend events emitted by actual production AGENTOS services
 * flow through:
 *   Production AGENTOS Service
 *   → EventBus
 *   → LiveEventBridge
 *   → LiveEventStream
 *   → Subscriber / Query functions
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
import { VerificationService } from "../packages/verification/Verification";
import { QAService } from "../packages/verification/QA";
import { ProofToPayService } from "../packages/verification/ProofToPay";
import { ProjectVerificationService } from "../packages/orchestration/ProjectVerification";
import { ProjectQAService } from "../packages/orchestration/ProjectQA";
import { ProjectProofToPayService } from "../packages/orchestration/ProjectProofToPay";
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
import { BudgetService } from "../packages/economy/Budget";
import { TransactionService } from "../packages/economy/Transactions";
import { CreditEngine } from "../packages/economy/CreditEngine";
import { LiveEventStream, type StreamEvent } from "../packages/events/LiveEventStream";
import { LiveEventBridge } from "../packages/events/LiveEventStream/bridge";
import type { Task } from "../packages/core/Task";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── Agents & Registry ─────────────────────────────────────────────────────────

const registry = new AgentRegistry();
const boss = createBoss("boss-stream", "Boss");
const manager = createManager("manager-stream", "Engineering Manager", boss.id);
const worker = createWorker("worker-stream", "Frontend Developer", manager.id);
const verifier = createBoss("verifier-stream", "Independent Verifier");

for (const a of [boss, manager, worker, verifier]) registry.register(a);

// ── Infrastructure & Production Services ──────────────────────────────────────

const messages = new AgentMessageService();
const identity = new IdentityService();
for (const a of [boss, manager, worker, verifier]) identity.createIdentity({ agentId: a.id, role: a.role });

const wallet = new WalletService();
wallet.createWallet(worker.id, 1000, 2000, 500);

const budgetSvc = new BudgetService();
budgetSvc.createBudget("budget-stream", worker.id, 1000, 600);

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

const evidenceSvc = new EvidenceService();
const executionSvc = new ExecutionService(evidenceSvc);
const verificationSvc = new VerificationService();
const qaSvc = new QAService();

const creditEngine = new CreditEngine(
  new PermissionEngine(),
  new PolicyEngine(),
  wallet,
  budgetSvc,
  new TransactionService(),
  security
);
const proofToPaySvc = new ProofToPayService(evidenceSvc, verificationSvc, qaSvc, creditEngine);

const organization = new OrganizationService(registry);
organization.createOrganization("org-stream", "AGENTOS", boss.id, "2026-09-11T00:00:00.000Z");
organization.addManager(manager.id, "frontend");
organization.addWorker(worker.id, "frontend");

const conference = new ConferenceRoomService(registry, messages);
const allocationSvc = new ManagerAllocationService(registry, organization, conference, runtime, messages);
const lifecycle = new ManagerTaskLifecycle(registry, organization, allocationSvc, runtime, depMgr, recovery, escalation);
const coordination = new LiveCoordinationService(registry, allocationSvc, lifecycle, runtime, messages, escalation, intervention);

// ── Live Event Stream & Bridge Setup ──────────────────────────────────────────

const stream = new LiveEventStream();
const capturedEvents: StreamEvent[] = [];
const unsubscribe = stream.subscribe((evt) => {
  capturedEvents.push(evt);
});

const bridge = new LiveEventBridge(stream, {
  runtimeEvents: runtime.events,
  executionEvents: executionSvc.events,
  verificationEvents: verificationSvc.events,
  qaEvents: qaSvc.events,
  paymentEvents: proofToPaySvc.events,
  recoveryEvents: recovery.events,
  escalationEvents: escalation.events,
  interventionEvents: intervention.events,
  allocationEvents: allocationSvc.events,
  conferenceEvents: conference.events,
});

// ── Step 1: Conference & Allocation Events ────────────────────────────────────

const meeting = conference.createMeeting({
  id: "meeting-stream",
  projectId: "proj-stream",
  calledBy: boss.id,
  participants: [manager.id],
  agenda: "Stream allocation",
});
conference.startMeeting(meeting.id);
const decision = conference.createDecision({
  id: "decision-stream",
  meetingId: meeting.id,
  decidedBy: boss.id,
  decisionType: "ASSIGN_MANAGER",
  summary: "Manager owns Stream module",
  taskIds: ["task-stream-parent"],
  managerId: manager.id,
});
conference.completeMeeting(meeting.id);

const parentTask: Task = {
  id: "task-stream-parent",
  title: "Parent Stream Task",
  description: "Parent description",
  assignedTo: null,
  createdBy: manager.id,
  status: "queued",
  priority: "high",
  dependencies: [],
  budget: 0, spent: 0, createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z",
};

const tasks = new Map<string, Task>([["task-stream-parent", parentTask]]);

allocationSvc.createAllocation({
  id: "alloc-stream",
  organizationId: "org-stream",
  meetingId: meeting.id,
  decisionId: decision.id,
  projectId: "proj-stream",
  managerId: manager.id,
  taskIds: ["task-stream-parent"],
  decomposeTaskIds: ["task-stream-parent"],
  assignedBy: boss.id,
}, tasks);

allocationSvc.approveAllocation("alloc-stream", boss.id);
allocationSvc.activateAllocation("alloc-stream", tasks);

console.log("STEP 1: Conference & Manager Allocation events captured by Stream");

// ── Step 2: Task Decomposition & Governed Delegation ─────────────────────────

const decomp = lifecycle.decomposeAllocatedTask("alloc-stream", manager.id, parentTask, [
  { id: "sub-stream-1", title: "Subtask Stream UI", description: "UI Component", priority: "high" },
], tasks);
assert(decomp.decision === "DECOMPOSED", "Decomposition failed");
const subtask = tasks.get("sub-stream-1")!;

const del = coordination.delegateSubtask("alloc-stream", manager.id, subtask, worker.id, tasks);
assert(del.decision === "DELEGATED", "Delegation failed");

console.log("STEP 2: Task decomposition & delegation events captured by Stream");

// ── Step 3: Execution, Evidence, Verification, QA, Payment ───────────────────

const started = runtime.startTask(tasks.get("sub-stream-1")!);
tasks.set("sub-stream-1", started);

executionSvc.start(started, registry.get(worker.id)!);
const execRecord = executionSvc.execute(started, registry.get(worker.id)!, {
  success: true,
  output: "Stream module executed",
  evidence: { type: "test_result", title: "Stream test suite", description: "All pass", reference: "stream-ref-1" },
});
assert(execRecord.status === "completed", "Execution failed");

const verifiedUI = runtime.completeTask(started);
tasks.set("sub-stream-1", verifiedUI);

const projVerification = new ProjectVerificationService(registry, evidenceSvc, verificationSvc);
const verReq = projVerification.request(execRecord, verifier, "ver-stream-1");
const verPass = projVerification.pass("ver-stream-1", verifier, 96, "Verified stream output");
assert(verPass.decision === "PASSED", "Verification failed");

const projQA = new ProjectQAService(registry, evidenceSvc, qaSvc);
const qaReq = projQA.request(verPass.verification!, verifier, "qa-stream-1", ["Check A"]);
const qaPass = projQA.pass("qa-stream-1", verifier, 97);
assert(qaPass.decision === "PASSED", "QA failed");

const projProofToPay = new ProjectProofToPayService(evidenceSvc, proofToPaySvc);
const payResult = projProofToPay.pay(execRecord, verPass.verification!, qaPass.qa!, {
  id: "pay-stream-1",
  agent: registry.get(worker.id)!,
  taskId: "sub-stream-1",
  amount: 100,
  reason: "Stream work paid",
  riskScore: 10,
  budgetId: "budget-stream",
});
assert(payResult.decision === "PAID", "Payment failed");

const completedTask = runtime.finalizeTask(verifiedUI);
tasks.set("sub-stream-1", completedTask);

console.log("STEP 3: Execution, Evidence, Verification, QA, Payment, Finalization events captured");

// ── Step 4: Verify LiveEventStream Filtering and Subscriber Results ───────────

assert(capturedEvents.length > 0, "No events captured by subscriber");

const projectEvents = stream.getByProject("proj-stream");
assert(projectEvents.length >= 3, "Expected project-filtered stream events");

const taskEvents = stream.getByTask("sub-stream-1");
assert(taskEvents.length >= 4, "Expected task-filtered stream events");

const evidenceEvts = stream.getByType("EVIDENCE_SUBMITTED");
assert(evidenceEvts.length >= 1, "Expected EVIDENCE_SUBMITTED stream event");
assert(evidenceEvts[0].taskId === "sub-stream-1", "Evidence event task ID mismatch");

const verEvts = stream.getByType("VERIFICATION_PASSED");
assert(verEvts.length >= 1, "Expected VERIFICATION_PASSED stream event");

const qaEvts = stream.getByType("QA_PASSED");
assert(qaEvts.length >= 1, "Expected QA_PASSED stream event");

const payEvts = stream.getByType("PAYMENT_RELEASED");
assert(payEvts.length >= 1, "Expected PAYMENT_RELEASED stream event");

const taskCompletedEvts = stream.getByType("TASK_COMPLETED");
assert(taskCompletedEvts.length >= 1, "Expected TASK_COMPLETED stream event");

console.log("\n── LIVE EVENT STREAM SUMMARY ────────────────────────────────────────────");
console.log(`TOTAL STREAM EVENTS CAPTURED: ${stream.getEventCount()}`);
console.log(`SUBSCRIBER RECEIVED EVENTS  : ${capturedEvents.length}`);
console.log(`PROJECT EVENTS (proj-stream): ${projectEvents.length}`);
console.log(`TASK EVENTS (sub-stream-1)  : ${taskEvents.length}`);
console.log(`EVIDENCE SUBMITTED EVENTS  : ${evidenceEvts.length}`);
console.log(`VERIFICATION PASSED EVENTS : ${verEvts.length}`);
console.log(`QA PASSED EVENTS           : ${qaEvts.length}`);
console.log(`PAYMENT RELEASED EVENTS    : ${payEvts.length}`);
console.log(`TASK COMPLETED EVENTS      : ${taskCompletedEvts.length}`);
console.log("─────────────────────────────────────────────────────────────────────────");

bridge.disconnect();
unsubscribe();

console.log("\n✅ Governed Live Event Stream integration test passed.");
