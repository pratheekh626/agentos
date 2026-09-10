import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";

import { AgentRegistry } from "../../agents/AgentRegistry";
import { TaskDispatcher } from "../TaskDispatcher";
import { DependencyManager } from "../Dependencies";
import { DelegationService } from "../Delegation";

import { DelegationFirewall } from "../../governance/DelegationFirewall";
import { ApprovalEngine } from "../../governance/ApprovalEngine";
import { PermissionEngine } from "../../governance/PermissionEngine";
import { PolicyEngine } from "../../governance/PolicyEngine";
import { IdentityService } from "../../security/Identity";
import { AccessControlService } from "../../security/AccessControl";
import { RiskEngine } from "../../security/RiskEngine";
import { AnomalyDetectionService } from "../../security/AnomalyDetection";
import { KillSwitchService } from "../../security/KillSwitch";
import { SecurityGateway } from "../../security/SecurityGateway";
import { WalletService } from "../../economy/Wallet";
import { Scheduler } from "./index";

const registry = new AgentRegistry();

const manager: Agent = {
  id: "manager-001",
  name: "Engineering Manager",
  role: "manager",
  managerId: null,
  status: "idle",
  permissions: {
    canDelegate: true,
    canExecuteTools: false,
    canSpendCredits: false,
    canApproveWork: false,
  },
  trustScore: 90,
  createdAt: new Date().toISOString(),
};

const worker: Agent = {
  id: "worker-001",
  name: "Frontend Developer",
  role: "worker",
  managerId: manager.id,
  status: "idle",
  permissions: {
    canDelegate: false,
    canExecuteTools: true,
    canSpendCredits: true,
    canApproveWork: false,
  },
  trustScore: 90,
  createdAt: new Date().toISOString(),
};

registry.register(manager);
registry.register(worker);

const dispatcher = new TaskDispatcher(registry);
const dependencyManager = new DependencyManager();
const permissionEngine = new PermissionEngine();
const policyEngine = new PolicyEngine();
const firewall = new DelegationFirewall(
  permissionEngine,
  policyEngine
);
const approvalEngine = new ApprovalEngine();
const identityService = new IdentityService();

identityService.createIdentity({
  agentId: manager.id,
  role: manager.role,
});

identityService.createIdentity({
  agentId: worker.id,
  role: worker.role,
});

const accessControl = new AccessControlService(identityService);
const riskEngine = new RiskEngine();
const anomalyDetection = new AnomalyDetectionService();
const walletService = new WalletService();

walletService.createWallet(worker.id, 500, 300, 200);

const killSwitch = new KillSwitchService(
  identityService,
  walletService
);

const securityGateway = new SecurityGateway(
  identityService,
  accessControl,
  riskEngine,
  anomalyDetection,
  killSwitch
);

const delegation = new DelegationService(
  registry,
  firewall,
  approvalEngine,
  dispatcher,
  securityGateway
);

const scheduler = new Scheduler(
  registry,
  dependencyManager,
  delegation
);

function createTask(
  id: string,
  priority: Task["priority"] = "medium"
): Task {
  return {
    id,
    title: `Task ${id}`,
    description: `Description for ${id}`,
    assignedTo: null,
    createdBy: manager.id,
    status: "queued",
    priority,
    dependencies: [],
    budget: 100,
    spent: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const task = createTask("task-001", "high");
const tasks = new Map<string, Task>([[task.id, task]]);
const scheduled = scheduler.schedule(tasks, manager);

console.log("\nSUCCESSFUL SCHEDULING:");
console.log(scheduled);

if (scheduled.decision !== "SCHEDULED") {
  throw new Error("Expected task to be scheduled");
}

if (scheduled.agent?.id !== worker.id) {
  throw new Error("Expected worker-001 to be selected");
}

if (scheduled.task?.assignedTo !== worker.id) {
  throw new Error("Expected task to be assigned to worker-001");
}

if (registry.get(worker.id)?.status !== "working") {
  throw new Error("Expected worker to become working");
}

registry.update(worker.id, { status: "idle" });

const dependencyTask = createTask("task-dependent");
dependencyTask.dependencies = ["task-parent"];

const parentTask = createTask("task-parent");
parentTask.status = "in_progress";
const blockedTasks = new Map<string, Task>([
  [dependencyTask.id, dependencyTask],
  [parentTask.id, parentTask],
]);

const blocked = scheduler.schedule(blockedTasks, manager);

console.log("\nBLOCKED DEPENDENCY:");
console.log(blocked);

if (blocked.decision !== "BLOCKED") {
  throw new Error(
    "Expected task with incomplete dependency to be blocked"
  );
}

const circularA = createTask("task-circular-a");
const circularB = createTask("task-circular-b");

circularA.dependencies = [circularB.id];
circularB.dependencies = [circularA.id];

const circularTasks = new Map<string, Task>([
  [circularA.id, circularA],
  [circularB.id, circularB],
]);

const circular = scheduler.schedule(circularTasks, manager);

console.log("\nCIRCULAR DEPENDENCY:");
console.log(circular);

if (circular.decision !== "BLOCKED") {
  throw new Error("Expected circular dependency to block scheduling");
}

registry.update(worker.id, { status: "paused" });

const noWorkerTask = createTask("task-no-worker");
const noWorkerTasks = new Map<string, Task>([
  [noWorkerTask.id, noWorkerTask],
]);

const noWorker = scheduler.schedule(noWorkerTasks, manager);

console.log("\nNO ELIGIBLE WORKER:");
console.log(noWorker);

if (noWorker.decision !== "NO_WORKER") {
  throw new Error("Expected no eligible worker result");
}

registry.update(worker.id, { status: "idle" });

const escalationTask = createTask("task-escalation");
const escalationTasks = new Map<string, Task>([
  [escalationTask.id, escalationTask],
]);

const escalated = scheduler.schedule(
  escalationTasks,
  manager,
  60
);

console.log("\nHIGH-RISK ESCALATION:");
console.log(escalated);

if (escalated.decision !== "ESCALATE") {
  throw new Error("Expected high-risk delegation to escalate");
}

if (!escalated.approvalRequestId) {
  throw new Error("Expected an approval request for escalation");
}

if (registry.get(worker.id)?.status !== "idle") {
  throw new Error("Expected escalated task not to assign the worker");
}

const deniedTask = createTask("task-denied");
const deniedTasks = new Map<string, Task>([
  [deniedTask.id, deniedTask],
]);

const denied = scheduler.schedule(
  deniedTasks,
  manager,
  80
);

console.log("\nGOVERNANCE DENIAL:");
console.log(denied);

if (denied.decision !== "DENY") {
  throw new Error("Expected governance denial for excessive risk");
}

if (registry.get(worker.id)?.status !== "idle") {
  throw new Error("Expected denied task not to assign the worker");
}

console.log("\nScheduler tests passed.");
