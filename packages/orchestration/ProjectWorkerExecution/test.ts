import { AgentMessageService } from "../../messaging/AgentMessages";
import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";
import { ApprovalEngine } from "../../governance/ApprovalEngine";
import { DelegationFirewall } from "../../governance/DelegationFirewall";
import { PermissionEngine } from "../../governance/PermissionEngine";
import { PolicyEngine } from "../../governance/PolicyEngine";
import { AccessControlService } from "../../security/AccessControl";
import { AnomalyDetectionService } from "../../security/AnomalyDetection";
import { IdentityService } from "../../security/Identity";
import { KillSwitchService } from "../../security/KillSwitch";
import { RiskEngine } from "../../security/RiskEngine";
import { SecurityGateway } from "../../security/SecurityGateway";
import { WalletService } from "../../economy/Wallet";
import { EvidenceService } from "../../verification/Evidence";
import { ExecutionService } from "../../agents/Execution";
import { AgentRuntime } from "../../agents/Runtime";
import { TaskDispatcher } from "../TaskDispatcher";
import { DelegationService } from "../Delegation";
import { DependencyManager } from "../Dependencies";
import { Scheduler } from "../Scheduler";
import { ProjectWorkerExecutionService } from "./index";
import type { Agent } from "../../core/Agent";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const manager = createManager("manager-001", "Manager", boss.id);
const worker = createWorker("worker-001", "Worker", manager.id);
const otherWorker = createWorker(
  "worker-002",
  "Other Worker",
  manager.id
);

for (const agent of [boss, manager, worker, otherWorker]) {
  registry.register(agent);
}

const identity = new IdentityService();
for (const agent of [boss, manager, worker, otherWorker]) {
  identity.createIdentity({ agentId: agent.id, role: agent.role });
}

const dispatcher = new TaskDispatcher(registry);
const delegation = new DelegationService(
  registry,
  new DelegationFirewall(new PermissionEngine(), new PolicyEngine()),
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
const runtime = new AgentRuntime(
  registry,
  dispatcher,
  new DependencyManager(),
  delegation,
  new Scheduler(registry, new DependencyManager(), delegation),
  new AgentMessageService()
);
const evidence = new EvidenceService();
const execution = new ExecutionService(evidence);
const bridge = new ProjectWorkerExecutionService(
  runtime,
  execution
);

const task = dispatcher.assignTask(
  dispatcher.createTask(
    "task-worker-execution",
    "Build portal",
    "Build the client portal.",
    manager.id,
    "high",
    100
  ),
  worker.id
);

const successful = bridge.execute(
  task,
  worker,
  {
    success: true,
    output: "Portal built successfully.",
    evidence: {
      type: "test_result",
      title: "Portal build",
      description: "Build and tests passed.",
      reference: "build-001",
    },
  }
);

if (
  successful.decision !== "EXECUTED" ||
  successful.task?.status !== "in_progress" ||
  successful.task.assignedTo !== worker.id ||
  successful.execution?.status !== "completed" ||
  !successful.execution.evidenceId ||
  evidence.get(successful.execution.evidenceId) === undefined
) {
  throw new Error("Expected successful worker execution with evidence");
}

try {
  bridge.execute(task, worker, {
    success: true,
    output: "Duplicate execution",
    evidence: null,
  });
  throw new Error("Expected duplicate execution to be rejected");
} catch (error) {
  if (
    !(error instanceof Error) ||
    !error.message.includes("Execution already exists")
  ) {
    throw error;
  }
}

const failedTask = dispatcher.assignTask(
  dispatcher.createTask(
    "task-worker-failure",
    "Failing task",
    "This task will fail.",
    manager.id
  ),
  worker.id
);
const failed = bridge.execute(
  failedTask,
  worker,
  {
    success: false,
    output: "Worker could not complete the task.",
    evidence: null,
  }
);

if (
  failed.execution?.status !== "failed" ||
  failed.execution.evidenceId !== null
) {
  throw new Error("Expected canonical failed execution behavior");
}

const unregisteredWorker: Agent = {
  ...worker,
  id: "worker-missing",
};

if (
  bridge.execute(task, unregisteredWorker, {
    success: true,
    output: "Should be rejected",
    evidence: null,
  }).decision !== "REJECTED"
) {
  throw new Error("Expected unregistered worker rejection");
}

if (
  bridge.execute(task, otherWorker, {
    success: true,
    output: "Should be rejected",
    evidence: null,
  }).decision !== "REJECTED"
) {
  throw new Error("Expected worker ownership rejection");
}

const queued = dispatcher.createTask(
  "task-queued",
  "Queued task",
  "Not assigned yet.",
  manager.id
);

if (
  bridge.execute(queued, worker, {
    success: true,
    output: "Should be rejected",
    evidence: null,
  }).decision !== "REJECTED"
) {
  throw new Error("Expected invalid task state rejection");
}

console.log("Project worker execution tests passed.");