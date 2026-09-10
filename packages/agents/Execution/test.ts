import { AgentRegistry } from "../AgentRegistry";
import { createManager } from "../Managers";
import { createWorker } from "../Workers";

import { TaskDispatcher } from "../../orchestration/TaskDispatcher";
import { EvidenceService } from "../../verification/Evidence";
import { ExecutionService } from ".";

const registry = new AgentRegistry();
const manager = createManager(
  "manager-001",
  "Engineering Manager",
  "boss-001"
);
const worker = createWorker(
  "worker-001",
  "Frontend Developer",
  manager.id
);

registry.register(manager);
registry.register(worker);

const dispatcher = new TaskDispatcher(registry);
const evidenceService = new EvidenceService();
const execution = new ExecutionService(evidenceService);

let startedEvent = false;
let evidenceEvent = false;
let completedEvent = false;
let failedEvent = false;

execution.events.on("execution.started", () => {
  startedEvent = true;
});

execution.events.on("execution.evidence_created", () => {
  evidenceEvent = true;
});

execution.events.on("execution.completed", () => {
  completedEvent = true;
});

execution.events.on("execution.failed", () => {
  failedEvent = true;
});

const task = dispatcher.createTask(
  "task-execution-001",
  "Build landing page",
  "Build the frontend landing page",
  manager.id,
  "high",
  100
);
const assigned = dispatcher.assignTask(task, worker.id);
const started = dispatcher.startTask(assigned);
const executionRecord = execution.start(started, worker);

if (executionRecord.status !== "started" || !startedEvent) {
  throw new Error("Expected execution to start");
}

const completed = execution.execute(
  started,
  worker,
  {
    success: true,
    output: "Landing page built successfully.",
    evidence: {
      type: "test_result",
      title: "Landing page build result",
      description:
        "Frontend build and tests completed successfully.",
      reference: "build-test-run-001",
    },
  }
);

if (
  completed.status !== "completed" ||
  completed.output !== "Landing page built successfully." ||
  !completed.evidenceId ||
  !evidenceEvent ||
  !completedEvent
) {
  throw new Error("Expected successful execution with evidence");
}

const evidence = evidenceService.get(completed.evidenceId);

if (
  !evidence ||
  evidence.taskId !== started.id ||
  evidence.agentId !== worker.id
) {
  throw new Error("Expected task-owned execution evidence");
}

const failedTask = dispatcher.createTask(
  "task-execution-002",
  "Failed task",
  "Task that will fail",
  manager.id
);
const failedAssigned = dispatcher.assignTask(
  failedTask,
  worker.id
);
const failedStarted = dispatcher.startTask(failedAssigned);

execution.start(failedStarted, worker);

const failed = execution.execute(
  failedStarted,
  worker,
  {
    success: false,
    output:
      "Build failed because a dependency was unavailable.",
    evidence: null,
  }
);

if (
  failed.status !== "failed" ||
  failed.evidenceId !== null ||
  !failedEvent
) {
  throw new Error("Expected failed execution without evidence");
}

console.log("Execution tests passed.");
