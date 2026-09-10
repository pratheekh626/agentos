import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";

import {
  PermissionEngine,
} from "../PermissionEngine";

import {
  PolicyEngine,
} from "./index";

import {
  DelegationFirewall,
} from "../DelegationFirewall";

const registry = new AgentRegistry();

const boss = createBoss(
  "boss-001",
  "AGENTOS Boss"
);

const manager = createManager(
  "manager-001",
  "Engineering Manager",
  boss.id
);

const worker = createWorker(
  "worker-001",
  "Frontend Developer",
  manager.id
);

registry.register(boss);
registry.register(manager);
registry.register(worker);

const permissionEngine =
  new PermissionEngine();

const policyEngine =
  new PolicyEngine();

const firewall =
  new DelegationFirewall(
    permissionEngine,
    policyEngine
  );

console.log(
  "Manager delegation permission:",
  permissionEngine.hasPermission(
    manager,
    "delegate"
  )
);

console.log(
  "Worker delegation permission:",
  permissionEngine.hasPermission(
    worker,
    "delegate"
  )
);

console.log(
  "\nManager → Worker, low risk:"
);

console.log(
  firewall.evaluate({
    from: manager,
    to: worker,
    taskId: "task-001",
    riskScore: 10,
  })
);

console.log(
  "\nManager → Worker, medium risk:"
);

console.log(
  firewall.evaluate({
    from: manager,
    to: worker,
    taskId: "task-002",
    riskScore: 60,
  })
);

console.log(
  "\nManager → Worker, high risk:"
);

console.log(
  firewall.evaluate({
    from: manager,
    to: worker,
    taskId: "task-003",
    riskScore: 90,
  })
);

console.log(
  "\nWorker → Manager:"
);

console.log(
  firewall.evaluate({
    from: worker,
    to: manager,
    taskId: "task-004",
    riskScore: 10,
  })
);
