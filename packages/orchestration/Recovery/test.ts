import { AgentMessageService } from "../../messaging/AgentMessages";
import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";
import { ApprovalEngine } from "../../governance/ApprovalEngine";
import { DelegationFirewall } from "../../governance/DelegationFirewall";
import { PermissionEngine } from "../../governance/PermissionEngine";
import { PolicyEngine } from "../../governance/PolicyEngine";
import { TaskDispatcher } from "../TaskDispatcher";
import { DelegationService } from "../Delegation";
import { RecoveryService } from "./index";
import { AccessControlService } from "../../security/AccessControl";
import { AnomalyDetectionService } from "../../security/AnomalyDetection";
import { IdentityService } from "../../security/Identity";
import { KillSwitchService } from "../../security/KillSwitch";
import { RiskEngine } from "../../security/RiskEngine";
import { SecurityGateway } from "../../security/SecurityGateway";
import { WalletService } from "../../economy/Wallet";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const manager = createManager(
  "manager-001",
  "Manager",
  boss.id
);
const worker = createWorker(
  "worker-001",
  "Worker",
  manager.id
);
const replacement = createWorker(
  "worker-002",
  "Replacement",
  manager.id
);
const otherManager = createManager(
  "manager-002",
  "Other Manager",
  boss.id
);

for (const agent of [boss, manager, worker, replacement, otherManager]) {
  registry.register(agent);
}

const identity = new IdentityService();
for (const agent of [boss, manager, worker, replacement, otherManager]) {
  identity.createIdentity({
    agentId: agent.id,
    role: agent.role,
  });
}

const dispatcher = new TaskDispatcher(registry);
const delegation = new DelegationService(
  registry,
  new DelegationFirewall(
    new PermissionEngine(),
    new PolicyEngine()
  ),
  new ApprovalEngine(),
  dispatcher,
  new SecurityGateway(
    identity,
    new AccessControlService(identity),
    new RiskEngine(),
    new AnomalyDetectionService(),
    new KillSwitchService(identity, new WalletService())
  )
);
const messages = new AgentMessageService();
const recovery = new RecoveryService(
  registry,
  dispatcher,
  delegation,
  messages,
  2
);

function createAssignedTask(id: string, agentId = worker.id) {
  const task = dispatcher.createTask(
    id,
    `Task ${id}`,
    "Recoverable work",
    manager.id
  );

  return dispatcher.assignTask(task, agentId);
}

const retryTask = createAssignedTask("task-retry");
const retry = recovery.recover(
  retryTask,
  manager.id,
  "Worker process failed"
);

if (
  retry.decision !== "RECOVERED" ||
  retry.recovery?.action !== "retry" ||
  retry.recovery.status !== "recovered" ||
  retry.recovery.attempt !== 1 ||
  retry.task?.status !== "in_progress"
) {
  throw new Error("Expected worker retry recovery");
}

if (
  messages.getAll().filter(
    (message) => message.toAgentId === manager.id
  ).length !== 1
) {
  throw new Error("Expected successful recovery notification");
}

const secondRetry = recovery.recover(
  retryTask,
  manager.id,
  "Worker process failed again"
);

if (
  secondRetry.decision !== "RECOVERED" ||
  secondRetry.recovery?.attempt !== 2
) {
  throw new Error("Expected bounded retry count to increment");
}

const exhausted = recovery.recover(
  retryTask,
  manager.id,
  "Worker process failed once more"
);

if (
  exhausted.decision !== "FAILED" ||
  exhausted.recovery?.attempt !== 3
) {
  throw new Error("Expected maximum retry exhaustion");
}

const pausedTask = createAssignedTask("task-paused");
registry.update(worker.id, { status: "paused" });
registry.update(replacement.id, { status: "idle" });

const reassigned = recovery.recover(
  pausedTask,
  manager.id,
  "Worker was paused during execution"
);

if (
  reassigned.decision !== "RECOVERED" ||
  reassigned.recovery?.action !== "reassign" ||
  reassigned.agent?.id !== replacement.id ||
  reassigned.task?.assignedTo !== replacement.id
) {
  throw new Error("Expected governed replacement recovery");
}

registry.update(worker.id, { status: "idle" });
const offlineTask = createAssignedTask("task-offline");
registry.update(worker.id, { status: "offline" });
registry.update(replacement.id, { status: "working" });

const noReplacement = recovery.recover(
  offlineTask,
  manager.id,
  "Worker went offline"
);

if (
  noReplacement.decision !== "FAILED" ||
  noReplacement.message === null
) {
  throw new Error("Expected no replacement recovery failure");
}

const missingWorker = recovery.recover(
  {
    ...offlineTask,
    id: "task-missing-worker",
    assignedTo: "worker-missing",
  },
  manager.id,
  "Missing worker"
);

if (missingWorker.decision !== "DENY") {
  throw new Error("Expected missing worker denial");
}

const mismatch = recovery.recover(
  retryTask,
  otherManager.id,
  "Wrong manager"
);

if (mismatch.decision !== "DENY") {
  throw new Error("Expected worker manager mismatch denial");
}

const bossTask = {
  ...retryTask,
  id: "task-boss",
  assignedTo: boss.id,
};

if (
  recovery.recover(
    bossTask,
    manager.id,
    "Boss failure"
  ).decision !== "DENY"
) {
  throw new Error("Expected Boss recovery denial");
}

const noAssigned = recovery.recover(
  {
    ...retryTask,
    id: "task-unassigned",
    assignedTo: null,
  },
  manager.id,
  "Unassigned failure"
);

if (noAssigned.decision !== "DENY") {
  throw new Error("Expected unassigned task denial");
}

if (
  recovery.recover(
    retryTask,
    manager.id,
    ""
  ).decision !== "DENY"
) {
  throw new Error("Expected empty reason denial");
}

console.log("Recovery tests passed.");