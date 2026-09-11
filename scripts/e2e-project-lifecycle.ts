import { AgentRegistry } from "../packages/agents/AgentRegistry";
import { createBoss } from "../packages/agents/Boss";
import { createManager } from "../packages/agents/Managers";
import { createWorker } from "../packages/agents/Workers";
import { RequirementUnderstandingService } from "../packages/agents/RequirementUnderstanding";
import { ProjectIntakeService } from "../packages/agents/ProjectIntake";
import { BossPlanningService } from "../packages/agents/BossPlanning";
import { AgentMessageService } from "../packages/messaging/AgentMessages";
import { ApprovalEngine } from "../packages/governance/ApprovalEngine";
import { DelegationFirewall } from "../packages/governance/DelegationFirewall";
import { PermissionEngine } from "../packages/governance/PermissionEngine";
import { PolicyEngine } from "../packages/governance/PolicyEngine";
import { TaskDispatcher } from "../packages/orchestration/TaskDispatcher";
import { DependencyManager } from "../packages/orchestration/Dependencies";
import { DelegationService } from "../packages/orchestration/Delegation";
import { Scheduler } from "../packages/orchestration/Scheduler";
import { PlanExecutionService } from "../packages/orchestration/PlanExecution";
import { ProjectExecutionService } from "../packages/orchestration/ProjectExecution";
import { ProjectWorkerExecutionService } from "../packages/orchestration/ProjectWorkerExecution";
import { ProjectVerificationService } from "../packages/orchestration/ProjectVerification";
import { ProjectQAService } from "../packages/orchestration/ProjectQA";
import { ProjectProofToPayService } from "../packages/orchestration/ProjectProofToPay";
import { ExecutionService } from "../packages/agents/Execution";
import { EvidenceService } from "../packages/verification/Evidence";
import { VerificationService } from "../packages/verification/Verification";
import { QAService } from "../packages/verification/QA";
import { ProofToPayService } from "../packages/verification/ProofToPay";
import { PermissionEngine as CreditPermissionEngine } from "../packages/governance/PermissionEngine";
import { WalletService } from "../packages/economy/Wallet";
import { BudgetService } from "../packages/economy/Budget";
import { TransactionService } from "../packages/economy/Transactions";
import { CreditEngine } from "../packages/economy/CreditEngine";
import { IdentityService } from "../packages/security/Identity";
import { AccessControlService } from "../packages/security/AccessControl";
import { RiskEngine } from "../packages/security/RiskEngine";
import { AnomalyDetectionService } from "../packages/security/AnomalyDetection";
import { KillSwitchService } from "../packages/security/KillSwitch";
import { SecurityGateway } from "../packages/security/SecurityGateway";
import { AuditLedger } from "../packages/audit/AuditLedger";
import { AuditEventBridge } from "../packages/audit/EventBridge";
import { AgentRuntime } from "../packages/agents/Runtime";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "AGENTOS Boss");
const manager = createManager("manager-001", "Project Manager", boss.id);
const worker = createWorker("worker-001", "Frontend Worker", manager.id);
const secondWorker = createWorker(
  "worker-002",
  "QA Worker",
  manager.id
);
const verifier = createBoss("verifier-001", "Independent Verifier");

for (const agent of [boss, manager, worker, secondWorker, verifier]) {
  registry.register(agent);
}

const messages = new AgentMessageService();
const dispatcher = new TaskDispatcher(registry);
const dependencies = new DependencyManager();
const identity = new IdentityService();

for (const agent of [boss, manager, worker, secondWorker, verifier]) {
  identity.createIdentity({ agentId: agent.id, role: agent.role });
}

const wallet = new WalletService();
wallet.createWallet(worker.id, 1250, 2000, 500);
const budget = new BudgetService();
budget.createBudget("budget-e2e", worker.id, 1000, 600);
const transaction = new TransactionService();
const security = new SecurityGateway(
  identity,
  new AccessControlService(identity),
  new RiskEngine(),
  new AnomalyDetectionService(),
  new KillSwitchService(identity, wallet)
);
const delegation = new DelegationService(
  registry,
  new DelegationFirewall(new PermissionEngine(), new PolicyEngine()),
  new ApprovalEngine(),
  dispatcher,
  security
);
const scheduler = new Scheduler(registry, dependencies, delegation);
const runtime = new AgentRuntime(
  registry,
  dispatcher,
  dependencies,
  delegation,
  scheduler,
  messages
);

const requirementService = new RequirementUnderstandingService();
const requirement = requirementService.create({
  id: "requirement-e2e-001",
  clientId: "client-e2e-001",
  input:
    "Objective: Build a responsive project landing page with authentication.\nRequirements:\n- Users can authenticate.\n- Users can view the landing page.\nConstraints:\n- Must be responsive.\nDeliverables:\n- Deployed landing page.\nAcceptance Criteria:\n- Users can authenticate and view the page.",
  createdAt: "2026-09-11T00:00:00.000Z",
});
assert(requirement.status === "ready", "Requirement was not ready");

const project = new ProjectIntakeService(registry).intake(
  "project-e2e-001",
  boss.id,
  requirement,
  "2026-09-11T00:01:00.000Z"
);
assert(project.decision === "ACCEPTED" && project.project, "Project was not accepted");

const plan = new BossPlanningService(registry).plan(
  "plan-e2e-001",
  project.project,
  requirement,
  boss.id,
  "2026-09-11T00:02:00.000Z"
);
assert(plan.decision === "CREATED" && plan.plan, "Plan was not created");

const planExecution = new PlanExecutionService(registry, dispatcher);
const executedPlan = planExecution.execute(plan.plan);
assert(executedPlan.decision === "EXECUTED", "Plan was not executed");
assert(executedPlan.tasks.length > 0, "No actual tasks were created");

const projectExecution = new ProjectExecutionService(runtime);
const projectRun = projectExecution.start(
  plan.plan,
  executedPlan.tasks,
  manager
);
assert(projectRun.decision === "STARTED", "Project execution did not start");
assert(projectRun.scheduledTasks.length > 0, "No task was scheduled");
const assignedTask = projectRun.scheduledTasks[0];
assert(assignedTask.status === "assigned", "Task was not assigned");
assert(assignedTask.assignedTo === worker.id, "Expected worker assignment");

const evidenceService = new EvidenceService();
const executionService = new ExecutionService(evidenceService);
const verificationService = new VerificationService();
const qaService = new QAService();
const creditEngine = new CreditEngine(
  new CreditPermissionEngine(),
  new PolicyEngine(),
  wallet,
  budget,
  transaction,
  security
);
const proofToPay = new ProofToPayService(
  evidenceService,
  verificationService,
  qaService,
  creditEngine
);
const auditLedger = new AuditLedger();
const auditBridge = new AuditEventBridge(
  auditLedger,
  executionService.events,
  verificationService.events,
  qaService.events,
  proofToPay.events
);
const executionBridge = new ProjectWorkerExecutionService(
  runtime,
  executionService
);
const workerExecution = executionBridge.execute(
  assignedTask,
  worker,
  {
    success: true,
    output: "Landing page and authentication completed.",
    evidence: {
      type: "test_result",
      title: "E2E worker result",
      description: "The deterministic worker execution completed.",
      reference: "e2e-worker-result",
    },
  }
);
assert(workerExecution.execution?.status === "completed", "Execution did not complete");
assert(workerExecution.execution.evidenceId, "Execution produced no evidence");
assert(evidenceService.get(workerExecution.execution.evidenceId), "Evidence was not stored");

const projectVerification = new ProjectVerificationService(
  registry,
  evidenceService,
  verificationService
);
const selfVerification = projectVerification.request(
  workerExecution.execution,
  worker,
  "verification-self"
);
assert(selfVerification.decision === "REJECTED", "Worker verified its own work");
const verificationRequest = projectVerification.request(
  workerExecution.execution,
  verifier,
  "verification-e2e-001"
);
assert(verificationRequest.decision === "CREATED", "Verification was not created");
const verificationPass = projectVerification.pass(
  "verification-e2e-001",
  verifier,
  97,
  "Independent verification passed."
);
assert(verificationPass.decision === "PASSED", "Verification did not pass");

const projectQA = new ProjectQAService(
  registry,
  evidenceService,
  qaService
);
const qaRequest = projectQA.request(
  verificationPass.verification!,
  verifier,
  "qa-e2e-001",
  ["Functional checks", "Responsive checks"]
);
assert(qaRequest.decision === "CREATED", "QA was not created");
const qaPass = projectQA.pass("qa-e2e-001", verifier, 96);
assert(qaPass.decision === "PASSED", "QA did not pass");

const projectProofToPay = new ProjectProofToPayService(
  evidenceService,
  proofToPay
);
const payment = projectProofToPay.pay(
  workerExecution.execution,
  verificationPass.verification!,
  qaPass.qa!,
  {
    id: "payment-e2e-001",
    agent: worker,
    taskId: assignedTask.id,
    amount: 100,
    reason: "Approved E2E project work",
    riskScore: 10,
    budgetId: "budget-e2e",
  }
);
assert(payment.decision === "PAID", "Payment did not reach paid state");
assert(payment.payment?.creditResult?.decision === "ALLOW", "CreditEngine did not allow payment");
assert(auditLedger.verifyIntegrity(), "Audit ledger integrity failed");
assert(auditLedger.getByTask(assignedTask.id).length >= 4, "Expected lifecycle audit events");

const summary = [
  "CLIENT REQUEST",
  "REQUIREMENT READY",
  "PROJECT ACCEPTED",
  "PLAN CREATED",
  "TASK CREATED",
  "TASK SCHEDULED",
  "WORKER EXECUTED",
  "EVIDENCE CREATED",
  "VERIFICATION PASSED",
  "QA PASSED",
  "PAYMENT RESULT: PAID",
  `AUDIT EVENTS: ${auditLedger.getByTask(assignedTask.id).length}`,
];
console.log(summary.join("\n"));
auditBridge.disconnect();
