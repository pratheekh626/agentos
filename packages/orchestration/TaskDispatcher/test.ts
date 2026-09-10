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

console.log("\nWorker after completion:");
console.log(registry.get(developer.id));
