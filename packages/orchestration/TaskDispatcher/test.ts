import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";
import { TaskDispatcher } from "./index";

const registry = new AgentRegistry();

const boss = createBoss("boss-001", "AGENTOS Boss");

const manager = createManager(
  "manager-001",
  "Engineering Manager",
  boss.id
);

const developer = createWorker(
  "worker-001",
  "Frontend Developer",
  manager.id
);

registry.register(boss);
registry.register(manager);
registry.register(developer);

const dispatcher = new TaskDispatcher(registry);

let task = dispatcher.createTask(
  "task-001",
  "Build SaaS landing page",
  "Create the initial landing page for the client's SaaS product.",
  boss.id,
  "high",
  500
);

console.log("Created task:");
console.log(task);

task = dispatcher.assignTask(task, developer.id);

console.log("\nAssigned task:");
console.log(task);

task = dispatcher.startTask(task);

console.log("\nStarted task:");
console.log(task);

task = dispatcher.completeTask(task);

console.log("\nSubmitted for verification:");
console.log(task);

// ── Unit tests for finalizeTask status boundaries ──────────────────────────────

function assertThrows(fn: () => void, expectedSnippet: string) {
  try {
    fn();
    throw new Error("Expected function to throw, but it succeeded");
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes(expectedSnippet)) {
      throw new Error(`Expected error containing '${expectedSnippet}', got: ${err}`);
    }
  }
}

// 1. queued cannot be finalized
const queuedTask = dispatcher.createTask("t-queued", "T", "D", boss.id);
assertThrows(() => dispatcher.finalizeTask(queuedTask), "Only tasks in verification status can be finalized");

// 2. assigned cannot be finalized
const assignedTask = dispatcher.assignTask(queuedTask, developer.id);
assertThrows(() => dispatcher.finalizeTask(assignedTask), "Only tasks in verification status can be finalized");

// 3. in_progress cannot be finalized
const inProgressTask = dispatcher.startTask(assignedTask);
assertThrows(() => dispatcher.finalizeTask(inProgressTask), "Only tasks in verification status can be finalized");

// 4. verification CAN be finalized
const verificationTask = dispatcher.completeTask(inProgressTask);
const finalizedTask = dispatcher.finalizeTask(verificationTask);
if (finalizedTask.status !== "completed") {
  throw new Error("Expected finalized task to have status 'completed'");
}

// 5. completed cannot be finalized twice
assertThrows(() => dispatcher.finalizeTask(finalizedTask), "Only tasks in verification status can be finalized");

// 6. failed cannot be finalized
const failedTask = { ...verificationTask, status: "failed" as const };
assertThrows(() => dispatcher.finalizeTask(failedTask), "Only tasks in verification status can be finalized");

// 7. cancelled cannot be finalized
const cancelledTask = { ...verificationTask, status: "cancelled" as const };
assertThrows(() => dispatcher.finalizeTask(cancelledTask), "Only tasks in verification status can be finalized");

console.log("\nfinalizeTask state boundary tests passed.");
