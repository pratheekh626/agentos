import { DependencyManager } from "./index";
import type { Task } from "../../core/Task";

const dependencyManager = new DependencyManager();

const researchTask: Task = {
  id: "task-research",
  title: "Research SaaS competitors",
  description: "Research competing SaaS products.",
  assignedTo: "researcher-001",
  createdBy: "boss-001",
  status: "completed",
  priority: "high",
  dependencies: [],
  budget: 200,
  spent: 150,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const designTask: Task = {
  id: "task-design",
  title: "Design SaaS interface",
  description: "Create the product interface.",
  assignedTo: "designer-001",
  createdBy: "manager-001",
  status: "queued",
  priority: "high",
  dependencies: ["task-research"],
  budget: 300,
  spent: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const frontendTask: Task = {
  id: "task-frontend",
  title: "Build frontend",
  description: "Implement the approved interface.",
  assignedTo: "developer-001",
  createdBy: "manager-001",
  status: "queued",
  priority: "high",
  dependencies: ["task-design"],
  budget: 500,
  spent: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const tasks = new Map<string, Task>([
  [researchTask.id, researchTask],
  [designTask.id, designTask],
  [frontendTask.id, frontendTask],
]);

console.log(
  "Can design start:",
  dependencyManager.canStart(designTask, tasks)
);

console.log(
  "Can frontend start:",
  dependencyManager.canStart(frontendTask, tasks)
);

console.log(
  "Frontend blocked by:",
  dependencyManager.getBlockedDependencies(
    frontendTask,
    tasks
  )
);
