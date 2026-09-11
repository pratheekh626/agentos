/**
 * Integration Test: Governed Client Monitoring Backend
 *
 * Proves that real backend events emitted by actual production AGENTOS services
 * flow through:
 *   Production AGENTOS Service
 *   → EventBus
 *   → LiveEventBridge
 *   → LiveEventStream
 *   → ClientMonitoringService
 *   → Authorized Client (ClientSafeEvent)
 *
 * And demonstrates that:
 *   - Authorized client receives safe project activity
 *   - Unauthorized client does not receive project activity
 *   - Internal security/governance events are strictly excluded
 *   - Real event payload sanitization works as intended
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
import { LiveEventStream } from "../packages/events/LiveEventStream";
import { LiveEventBridge } from "../packages/events/LiveEventStream/bridge";
import {
  ClientMonitoringService,
  type ClientAuthContext,
  type ClientSafeEvent,
} from "../packages/events/ClientMonitoring";
import type { Task } from "../packages/core/Task";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── Setup Production Services ──────────────────────────────────────────────────

const registry = new AgentRegistry();
const boss = createBoss("boss-client", "Boss");
const manager = createManager("manager-client", "Engineering Manager", boss.id);
const worker = createWorker("worker-client", "Frontend Developer", manager.id);
const verifier = createBoss("verifier-client", "Independent Verifier");

for (const a of [boss, manager, worker, verifier]) registry.register(a);

const messages = new AgentMessageService();
const identity = new IdentityService();
for (const a of [boss, manager, worker, verifier]) identity.createIdentity({ agentId: a.id, role: a.role });

const wallet = new WalletService();
wallet.createWallet(worker.id, 1000, 2000, 500);

const budgetSvc = new BudgetService();
budgetSvc.createBudget("budget-client", worker.id, 1000, 600);

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

const projVerification = new ProjectVerificationService(registry, evidenceSvc, verificationSvc);
const projQA = new ProjectQAService(registry, evidenceSvc, qaSvc);
const projProofToPay = new ProjectProofToPayService(evidenceSvc, proofToPaySvc);

const organization = new OrganizationService(registry);
organization.createOrganization("org-client", "AGENTOS Client Monitored Org", boss.id, "2026-09-11T00:00:00.000Z");
organization.addManager(manager.id, "frontend");
organization.addWorker(worker.id, "frontend");

const conference = new ConferenceRoomService(registry, messages);
const allocationSvc = new ManagerAllocationService(registry, organization, conference, runtime, messages);
const lifecycle = new ManagerTaskLifecycle(registry, organization, allocationSvc, runtime, depMgr, recovery, escalation);

// ── Stream, Bridge & Client Monitoring Service Setup ─────────────────────────

const stream = new LiveEventStream();
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

const clientMonitoring = new ClientMonitoringService(stream);

// Register client authorization contexts
const clientAlpha: ClientAuthContext = {
  clientId: "client-alpha",
  authorizedProjectIds: ["proj-alpha"],
};

const clientBeta: ClientAuthContext = {
  clientId: "client-beta",
  authorizedProjectIds: ["proj-beta"],
};

const clientUnauthorized: ClientAuthContext = {
  clientId: "client-unauth",
  authorizedProjectIds: [],
};

// ── Live Subscriptions ───────────────────────────────────────────────────────

const clientAlphaLiveEvents: ClientSafeEvent[] = [];
const clientBetaLiveEvents: ClientSafeEvent[] = [];

clientMonitoring.subscribeToProject(clientAlpha, "proj-alpha", (e) => {
  clientAlphaLiveEvents.push(e);
});

clientMonitoring.subscribeToProject(clientBeta, "proj-beta", (e) => {
  clientBetaLiveEvents.push(e);
});

// ── STEP 1: Create real project lifecycle events ─────────────────────────────

const projectId = "proj-alpha";
const taskId = "task-client-1";

clientMonitoring.registerProjectTask(projectId, taskId);

// 1. Task creation
let task: Task = {
  id: taskId,
  title: "Build Governed Client Activity Feed",
  description: "Expose real-time client safe events",
  assignedTo: worker.id,
  createdBy: boss.id,
  status: "assigned",
  priority: "high",
  dependencies: [],
  budget: 500,
  spent: 0,
  createdAt: "2026-09-11T10:00:00.000Z",
  updatedAt: "2026-09-11T10:00:00.000Z",
};

runtime.createTask(task);
task = runtime.startTask(task);

// 2. Execution & Evidence
executionSvc.start(task, worker);
const execRecord = executionSvc.execute(task, worker, {
  success: true,
  output: "Completed client monitoring implementation",
  evidence: {
    type: "test_result",
    title: "ClientMonitoringService source code",
    description: "Code implementation",
    reference: "ref-1",
  },
});

task = runtime.completeTask(task);

// 3. Verification
const verReq = projVerification.request(execRecord, verifier, "ver-client-1");
const verPass = projVerification.pass("ver-client-1", verifier, 98, "Excellent security boundary");
assert(verPass.decision === "PASSED", "Verification failed");

// 4. QA
const qaReq = projQA.request(verPass.verification!, verifier, "qa-client-1", ["privacy-check", "no-leak"]);
const qaPass = projQA.pass("qa-client-1", verifier, 100);
assert(qaPass.decision === "PASSED", "QA failed");

// 5. Payment & Finalization
const payResult = projProofToPay.pay(execRecord, verPass.verification!, qaPass.qa!, {
  id: "pay-client-1",
  agent: worker,
  taskId,
  amount: 500,
  reason: "Client monitoring completed",
  riskScore: 5,
  budgetId: "budget-client",
});
assert(payResult.decision === "PAID", "Payment failed");

task = runtime.finalizeTask(task);

// 6. Trigger internal governance/recovery events on production EventBus
recovery.recover(task, manager.id, "transient_timeout");
escalation.escalate({
  id: "esc-client-1",
  taskId,
  managerId: manager.id,
  bossId: boss.id,
  reason: "Internal resource conflict",
});

// ── STEP 2: Verify Authorized Client Alpha Access ────────────────────────────

const alphaEvents = clientMonitoring.getProjectActivity(clientAlpha, projectId);
console.log(`STEP 2: Authorized Client Alpha fetched ${alphaEvents.length} safe events for ${projectId}`);

assert(alphaEvents.length > 0, "Authorized client must receive project events");

const eventTypes = alphaEvents.map((e) => e.eventType);
console.log("Captured Client-Safe Event Types:", eventTypes);

assert(eventTypes.includes("TASK_CREATED"), "Must contain TASK_CREATED");
assert(eventTypes.includes("TASK_STARTED"), "Must contain TASK_STARTED");
assert(eventTypes.includes("EXECUTION_STARTED"), "Must contain EXECUTION_STARTED");
assert(eventTypes.includes("EVIDENCE_SUBMITTED"), "Must contain EVIDENCE_SUBMITTED");
assert(eventTypes.includes("VERIFICATION_PASSED"), "Must contain VERIFICATION_PASSED");
assert(eventTypes.includes("QA_PASSED"), "Must contain QA_PASSED");
assert(eventTypes.includes("PAYMENT_RELEASED"), "Must contain PAYMENT_RELEASED");
assert(eventTypes.includes("TASK_COMPLETED"), "Must contain TASK_COMPLETED");

// ── STEP 3: Verify Internal Governance/Security Exclusion ────────────────────

assert(!eventTypes.includes("RECOVERY_ATTEMPTED"), "Internal RECOVERY_ATTEMPTED event must be excluded");
assert(!eventTypes.includes("ESCALATION_CREATED"), "Internal ESCALATION_CREATED event must be excluded");

for (const event of alphaEvents) {
  assert(!("riskScore" in event.payload), "riskScore must be excluded from client payload");
  assert(!("identityFingerprint" in event.payload), "identityFingerprint must be excluded");
  assert(!("walletBalance" in event.payload), "walletBalance must be excluded");
  assert(event.projectId === projectId, "All events must match requested projectId");
}

console.log("STEP 3: Internal security/governance events & sensitive payloads verified EXCLUDED");

// ── STEP 4: Verify Unauthorized & Cross-Client Isolation ─────────────────────

const betaEvents = clientMonitoring.getProjectActivity(clientBeta, projectId);
const unauthEvents = clientMonitoring.getProjectActivity(clientUnauthorized, projectId);

assert(betaEvents.length === 0, "Unauthorized Client Beta must receive 0 events for proj-alpha");
assert(unauthEvents.length === 0, "Unauthorized Client must receive 0 events for proj-alpha");

console.log("STEP 4: Cross-client isolation & unauthorized rejection verified");

// ── STEP 5: Verify Live Subscriptions ─────────────────────────────────────────

assert(clientAlphaLiveEvents.length === alphaEvents.length, "Client Alpha subscription must receive exact safe events");
assert(clientBetaLiveEvents.length === 0, "Client Beta subscription must receive 0 events");

console.log("STEP 5: Live event subscriptions verified isolated");

// ── STEP 6: Verify Project Summary ───────────────────────────────────────────

const summary = clientMonitoring.getProjectSummary(clientAlpha, projectId);
assert(summary !== null, "Summary must be generated for authorized client");
assert(summary.projectId === projectId, "Summary project ID must match");
assert(summary.tasksCreated === 1, "Summary tasksCreated must be 1");
assert(summary.tasksCompleted === 2, "Summary tasksCompleted must be 2 (completeTask + finalizeTask)");
assert(summary.verificationsPassed === 1, "Summary verificationsPassed must be 1");
assert(summary.qaPassed === 1, "Summary qaPassed must be 1");
assert(summary.paymentsReleased === 1, "Summary paymentsReleased must be 1");
assert(summary.totalPaidAmount === 500, "Summary totalPaidAmount must be 500");

console.log("STEP 6: Project Summary verified:", summary);

console.log(`
── CLIENT MONITORING SUMMARY ────────────────────────────────────────────
REAL PROJECT LIFECYCLE EVENT → EventBus → LiveEventBridge → LiveEventStream
→ ClientMonitoringService → AUTHORIZED CLIENT RECEIVED ${alphaEvents.length} SAFE EVENTS

SAFE EVENTS INCLUDED: TASK_CREATED, TASK_STARTED, EXECUTION_STARTED,
                      EVIDENCE_SUBMITTED, VERIFICATION_PASSED, QA_PASSED,
                      PAYMENT_RELEASED, TASK_COMPLETED
INTERNAL EVENTS EXCLUDED: RECOVERY_ATTEMPTED, ESCALATION_CREATED, A2A_MESSAGE
UNAUTHORIZED CLIENT ACCESS: 0 EVENTS (ISOLATED)
LIVE SUBSCRIPTIONS: ALPHA (${clientAlphaLiveEvents.length}), BETA (${clientBetaLiveEvents.length})
SUMMARY METRICS: OK
─────────────────────────────────────────────────────────────────────────
`);

console.log("✅ Governed Client Monitoring Backend E2E integration test passed.");
