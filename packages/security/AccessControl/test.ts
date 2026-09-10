import { AgentRegistry } from "../../agents/AgentRegistry";
import type { Agent } from "../../core/Agent";
import { IdentityService } from "../Identity";
import { AccessControlService } from "./index";

const registry = new AgentRegistry();
const identityService = new IdentityService();
const accessControl = new AccessControlService(identityService);

const boss: Agent = {
  id: "boss-001",
  name: "Boss Agent",
  role: "boss",
  managerId: null,
  status: "idle",
  permissions: {
    canDelegate: true,
    canExecuteTools: true,
    canSpendCredits: true,
    canApproveWork: true,
  },
  trustScore: 100,
  createdAt: new Date().toISOString(),
};

const manager: Agent = {
  id: "manager-001",
  name: "Engineering Manager",
  role: "manager",
  managerId: "boss-001",
  status: "idle",
  permissions: {
    canDelegate: true,
    canExecuteTools: true,
    canSpendCredits: true,
    canApproveWork: false,
  },
  trustScore: 95,
  createdAt: new Date().toISOString(),
};

const worker: Agent = {
  id: "worker-001",
  name: "Frontend Developer",
  role: "worker",
  managerId: "manager-001",
  status: "idle",
  permissions: {
    canDelegate: false,
    canExecuteTools: true,
    canSpendCredits: true,
    canApproveWork: false,
  },
  trustScore: 90,
  createdAt: new Date().toISOString(),
};

registry.register(boss);
registry.register(manager);
registry.register(worker);

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

console.log("\nBOSS DELEGATION:");
console.log(
  accessControl.check({
    agent: boss,
    action: "delegate",
    resource: "task-production",
  })
);

console.log("\nMANAGER DELEGATION:");
console.log(
  accessControl.check({
    agent: manager,
    action: "delegate",
    resource: "task-frontend",
  })
);

console.log("\nWORKER DELEGATION:");
console.log(
  accessControl.check({
    agent: worker,
    action: "delegate",
    resource: "task-backend",
  })
);

console.log("\nWORKER TOOL EXECUTION:");
console.log(
  accessControl.check({
    agent: worker,
    action: "execute_tool",
    resource: "github:create-pull-request",
  })
);

console.log("\nMANAGER APPROVAL:");
console.log(
  accessControl.check({
    agent: manager,
    action: "approve_work",
    resource: "task-frontend",
  })
);

console.log("\nWORKER APPROVAL:");
console.log(
  accessControl.check({
    agent: worker,
    action: "approve_work",
    resource: "task-frontend",
  })
);

console.log("\nREVOKED WORKER:");

identityService.revokeIdentity(worker.id);

console.log(
  accessControl.check({
    agent: worker,
    action: "execute_tool",
    resource: "github:create-pull-request",
  })
);

console.log("\nROLE MISMATCH:");

const fakeManager: Agent = {
  ...manager,
  role: "worker",
};

console.log(
  accessControl.check({
    agent: fakeManager,
    action: "delegate",
    resource: "task-test",
  })
);

console.log("\nEMPTY RESOURCE:");

console.log(
  accessControl.check({
    agent: boss,
    action: "read",
    resource: "",
  })
);

console.log("\nCAN ACCESS CHECK:");

console.log(
  "Boss can delegate:",
  accessControl.canAccess(
    boss,
    "delegate",
    "task-production"
  )
);

console.log(
  "Worker can approve:",
  accessControl.canAccess(
    worker,
    "approve_work",
    "task-production"
  )
);

console.log("\nAccessControl tests passed.");
