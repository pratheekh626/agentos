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
import { TaskDispatcher } from "../TaskDispatcher";
import { DelegationService } from "../Delegation";
import { DependencyManager } from "../Dependencies";
import { Scheduler } from "../Scheduler";
import { AgentRuntime } from "../../agents/Runtime";
import { ProjectExecutionService } from "./index";
import type { ExecutionPlan } from "../../agents/BossPlanning";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const manager = createManager("manager-001", "Manager", boss.id);
const worker = createWorker("worker-001", "Worker", manager.id);
const secondWorker = createWorker(
  "worker-002",
  "Second Worker",
  manager.id
);

for (const agent of [boss, manager, worker, secondWorker]) {
  registry.register(agent);
}

const identity = new IdentityService();
for (const agent of [boss, manager, worker, secondWorker]) {
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
const execution = new ProjectExecutionService(runtime);

const plan: ExecutionPlan = {
  id: "plan-project-001",
  projectId: "project-001",
  plannedBy: boss.id,
  createdAt: "2026-09-11T02:00:00.000Z",
  tasks: [
    {
      id: "task-parent",
      title: "Build foundation",
      description: "Build the foundation.",
      priority: "high",
      budget: 0,
      dependencies: [],
    },
    {
      id: "task-child",
      title: "Build feature",
      description: "Build the feature.",
      priority: "high",
      budget: 0,
      dependencies: ["task-parent"],
    },
  ],
};

const parent = dispatcher.createTask(
  "task-parent",
  "Build foundation",
  "Build the foundation.",
  boss.id,
  "high",
  0
);
const child = {
  ...dispatcher.createTask(
    "task-child",
    "Build feature",
    "Build the feature.",
    boss.id,
    "high",
    0
  ),
  dependencies: ["task-parent"],
};

const first = execution.start(
  plan,
  [parent, child],
  manager
);

if (
  first.decision !== "STARTED" ||
  first.scheduledTasks.length !== 1 ||
  first.scheduledTasks[0].id !== "task-parent" ||
  first.scheduledTasks[0].status !== "assigned" ||
  first.scheduledTasks[0].assignedTo !== worker.id ||
  first.status !== "blocked"
) {
  throw new Error("Expected ready parent task to be scheduled first");
}

if (
  String(first.scheduledTasks[0].status) === "in_progress" ||
  String(first.scheduledTasks[0].status) === "verification"
) {
  throw new Error("Project execution must not start or complete tasks");
}

const internalTasks = execution.getTasks(plan.id);

if (!internalTasks) {
  throw new Error("Expected internal task map");
}

internalTasks.find((task) => task.id === "task-parent")!.status =
  "completed";
registry.update(worker.id, { status: "idle" });

const resumed = execution.resume(plan.id, manager);

if (
  resumed.scheduledTasks.length !== 1 ||
  resumed.scheduledTasks[0].id !== "task-child"
) {
  throw new Error("Expected completed dependency to unlock child task");
}

const noWorkerExecution = new ProjectExecutionService(runtime);
registry.update(worker.id, { status: "paused" });
registry.update(secondWorker.id, { status: "paused" });
const noWorker = noWorkerExecution.start(
  {
    ...plan,
    id: "plan-no-worker",
    tasks: [plan.tasks[0]],
  },
  [parent],
  manager
);

if (noWorker.status !== "no_worker") {
  throw new Error("Expected existing NO_WORKER result");
}

registry.update(worker.id, { status: "idle" });
registry.update(secondWorker.id, { status: "idle" });
const riskExecution = new ProjectExecutionService(runtime);
const riskPlan = {
  ...plan,
  id: "plan-risk",
  tasks: [plan.tasks[0]],
};
const escalated = riskExecution.start(
  riskPlan,
  [parent],
  manager,
  60
);

if (
  escalated.status !== "escalated" ||
  !escalated.approvalRequestId ||
  escalated.scheduledTasks.length !== 0
) {
  throw new Error("Expected high-risk scheduling escalation");
}

const deniedExecution = new ProjectExecutionService(runtime);
const denied = deniedExecution.start(
  { ...riskPlan, id: "plan-denied" },
  [parent],
  manager,
  90
);

if (denied.status !== "denied" || denied.scheduledTasks.length !== 0) {
  throw new Error("Expected excessive-risk scheduling denial");
}

const rejected = execution.start(
  { ...plan, id: "plan-invalid-manager" },
  [parent, child],
  boss
);

if (rejected.decision !== "REJECTED") {
  throw new Error("Expected non-manager rejection");
}

if (
  execution.start(
    { ...plan, id: "plan-missing-task" },
    [parent],
    manager
  ).decision !== "REJECTED"
) {
  throw new Error("Expected missing task rejection");
}

if (
  execution.start(
    { ...plan, id: "plan-mismatch" },
    [{ ...parent, id: "wrong-task" }, child],
    manager
  ).decision !== "REJECTED"
) {
  throw new Error("Expected plan/task mismatch rejection");
}

if (
  execution.start(
    { ...plan, id: "plan-duplicate" },
    [parent, parent],
    manager
  ).decision !== "REJECTED"
) {
  throw new Error("Expected duplicate task rejection");
}

console.log("Project execution tests passed.");