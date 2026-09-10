import { AgentMessageService } from "../../messaging/AgentMessages";
import { AgentRegistry } from "../AgentRegistry";
import { createBoss } from "../Boss";
import { createManager } from "../Managers";
import { createWorker } from "../Workers";

import { ApprovalEngine } from "../../governance/ApprovalEngine";
import { DelegationFirewall } from "../../governance/DelegationFirewall";
import { PermissionEngine } from "../../governance/PermissionEngine";
import { PolicyEngine } from "../../governance/PolicyEngine";

import { DependencyManager } from "../../orchestration/Dependencies";
import { DelegationService } from "../../orchestration/Delegation";
import { TaskDispatcher } from "../../orchestration/TaskDispatcher";
import { Scheduler } from "../../orchestration/Scheduler";

import { AccessControlService } from "../../security/AccessControl";
import { AnomalyDetectionService } from "../../security/AnomalyDetection";
import { IdentityService } from "../../security/Identity";
import { KillSwitchService } from "../../security/KillSwitch";
import { RiskEngine } from "../../security/RiskEngine";
import { SecurityGateway } from "../../security/SecurityGateway";
import { WalletService } from "../../economy/Wallet";

import { AgentRuntime } from ".";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const manager = createManager(
  "manager-001",
  "Engineering Manager",
  boss.id
);
const worker = createWorker(
  "worker-001",
  "Developer",
  manager.id
);

registry.register(boss);
registry.register(manager);
registry.register(worker);

const identityService = new IdentityService();

for (const agent of [boss, manager, worker]) {
  identityService.createIdentity({
    agentId: agent.id,
    role: agent.role,
  });
}

const walletService = new WalletService();
const killSwitch = new KillSwitchService(
  identityService,
  walletService
);
const accessControl = new AccessControlService(identityService);
const securityGateway = new SecurityGateway(
  identityService,
  accessControl,
  new RiskEngine(),
  new AnomalyDetectionService(),
  killSwitch
);
const firewall = new DelegationFirewall(
  new PermissionEngine(),
  new PolicyEngine()
);
const dispatcher = new TaskDispatcher(registry);
const dependencyManager = new DependencyManager();
const delegation = new DelegationService(
  registry,
  firewall,
  new ApprovalEngine(),
  dispatcher,
  securityGateway
);
const scheduler = new Scheduler(
  registry,
  dependencyManager,
  delegation
);
const runtime = new AgentRuntime(
  registry,
  dispatcher,
  dependencyManager,
  delegation,
  scheduler,
  new AgentMessageService()
);

let createdEvent = false;
let scheduledEvent = false;
let startedEvent = false;
let completedEvent = false;
let messageEvent = false;

runtime.events.on("task.created", () => {
  createdEvent = true;
});
runtime.events.on("task.scheduled", () => {
  scheduledEvent = true;
});
runtime.events.on("task.started", () => {
  startedEvent = true;
});
runtime.events.on("task.completed", () => {
  completedEvent = true;
});
runtime.events.on("agent.message_sent", () => {
  messageEvent = true;
});

const task = runtime.createTask({
  id: "task-runtime-001",
  title: "Build landing page",
  description: "Create the product landing page",
  createdBy: manager.id,
  priority: "high",
  budget: 100,
});

if (task.status !== "queued" || !createdEvent) {
  throw new Error("Expected queued task and task.created event");
}

const tasks = new Map<string, typeof task>([[task.id, task]]);
const scheduled = runtime.schedule(tasks, manager);

if (
  scheduled.decision !== "SCHEDULED" ||
  scheduled.task?.assignedTo !== worker.id ||
  !scheduledEvent
) {
  throw new Error("Expected task to schedule and emit task.scheduled");
}

const assigned = scheduled.task;

if (!assigned) {
  throw new Error("Expected assigned task");
}

const started = runtime.startTask(assigned);

if (started.status !== "in_progress" || !startedEvent) {
  throw new Error("Expected task to start and emit task.started");
}

const finished = runtime.completeTask(started);

if (finished.status !== "verification" || !completedEvent) {
  throw new Error(
    "Expected task to enter verification and emit task.completed"
  );
}

const message = runtime.sendMessage({
  fromAgentId: manager.id,
  toAgentId: worker.id,
  type: "request",
  subject: "Start implementation",
  content: "Please begin implementing the landing page.",
  taskId: task.id,
  priority: "high",
});

if (
  message.fromAgentId !== manager.id ||
  message.toAgentId !== worker.id ||
  !messageEvent ||
  runtime.getMessagesForAgent(worker.id).length !== 1
) {
  throw new Error("Expected stored A2A message and event");
}

console.log("Agent Runtime tests passed.");
