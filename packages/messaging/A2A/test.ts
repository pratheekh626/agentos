import { AgentMessageService } from "../AgentMessages";
import type { A2AMessage } from "./index";

const messaging = new AgentMessageService();

const bossToManager: A2AMessage = {
  id: "msg-001",

  fromAgentId: "boss-001",
  toAgentId: "manager-001",

  type: "delegation",

  subject: "Build SaaS website",

  content:
    "Break the website project into design, frontend, backend, and testing tasks.",

  taskId: "project-001",

  priority: "high",

  createdAt: new Date().toISOString(),
};

const managerToWorker: A2AMessage = {
  id: "msg-002",

  fromAgentId: "manager-001",
  toAgentId: "worker-001",

  type: "delegation",

  subject: "Build landing page",

  content:
    "Implement the landing page based on the approved design.",

  taskId: "task-frontend",

  priority: "high",

  createdAt: new Date().toISOString(),
};

messaging.send(bossToManager);
messaging.send(managerToWorker);

console.log("Total messages:", messaging.getAll().length);

console.log(
  "Boss messages:",
  messaging.getByAgent("boss-001")
);

console.log(
  "Manager messages:",
  messaging.getByAgent("manager-001")
);

console.log(
  "Frontend task messages:",
  messaging.getByTask("task-frontend")
);
