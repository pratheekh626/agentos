import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";

import {
  PermissionEngine,
} from "../../governance/PermissionEngine";

import {
  PolicyEngine,
} from "../../governance/PolicyEngine";

import {
  DelegationFirewall,
} from "../../governance/DelegationFirewall";

import {
  ApprovalEngine,
} from "../../governance/ApprovalEngine";

import {
  TaskDispatcher,
} from "../TaskDispatcher";

import {
  DelegationService,
} from "./index";


import {
  IdentityService,
} from "../../security/Identity";

import {
  AccessControlService,
} from "../../security/AccessControl";

import {
  RiskEngine,
} from "../../security/RiskEngine";

import {
  AnomalyDetectionService,
} from "../../security/AnomalyDetection";

import {
  KillSwitchService,
} from "../../security/KillSwitch";

import {
  SecurityGateway,
} from "../../security/SecurityGateway";

import {
  WalletService,
} from "../../economy/Wallet";

const registry = new AgentRegistry();

const boss = createBoss(
  "boss-001",
  "AGENTOS Boss"
);

const manager = createManager(
  "manager-001",
  "Engineering Manager",
  boss.id
);

const worker = createWorker(
  "worker-001",
  "Frontend Developer",
  manager.id
);

registry.register(boss);
registry.register(manager);
registry.register(worker);

const permissionEngine =
  new PermissionEngine();

const policyEngine =
  new PolicyEngine();

const firewall =
  new DelegationFirewall(
    permissionEngine,
    policyEngine
  );

const approvalEngine =
  new ApprovalEngine();

const taskDispatcher =
  new TaskDispatcher(registry);

const identityService =
  new IdentityService();

identityService.createIdentity({
  agentId: boss.id,
  role: boss.role,
});

identityService.createIdentity({
  agentId: manager.id,
  role: manager.role,
});

identityService.createIdentity({
  agentId: worker.id,
  role: worker.role,
});

const walletService =
  new WalletService();

const killSwitch =
  new KillSwitchService(
    identityService,
    walletService
  );

const accessControl =
  new AccessControlService(
    identityService
  );

const riskEngine =
  new RiskEngine();

const anomalyDetection =
  new AnomalyDetectionService();

const securityGateway =
  new SecurityGateway(
    identityService,
    accessControl,
    riskEngine,
    anomalyDetection,
    killSwitch
  );

const delegation =
  new DelegationService(
    registry,
    firewall,
    approvalEngine,
    taskDispatcher,
    securityGateway
  );

const task =
  taskDispatcher.createTask(
    "task-production",
    "Deploy production application",
    "Deploy the approved application.",
    manager.id,
    "critical",
    500
  );

const escalation =
  delegation.delegate(
    manager,
    worker,
    task,
    60
  );

console.log(
  "ESCALATED:",
  escalation
);

if (!escalation.approvalRequestId) {
  throw new Error(
    "Expected delegation to require approval"
  );
}

const approved =
  delegation.approveDelegation(
    escalation.approvalRequestId,
    boss.id
  );

console.log(
  "\nAPPROVED:",
  approved
);

if (
  approved.decision !== "ALLOW" ||
  !approved.task ||
  approved.task.assignedTo !== worker.id
) {
  throw new Error(
    "Approved delegation was not assigned to worker"
  );
}

console.log(
  "\nWorker after approval:",
  registry.get(worker.id)
);

const workerTask =
  taskDispatcher.createTask(
    "task-worker-denied",
    "Restricted operation",
    "Worker attempts unauthorized delegation.",
    worker.id,
    "high",
    100
  );

const denied =
  delegation.delegate(
    worker,
    manager,
    workerTask,
    10
  );

console.log(
  "\nWORKER DELEGATION:",
  denied
);
