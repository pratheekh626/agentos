import { AgentRegistry } from "./index";
import { createBoss } from "../Boss";
import { createManager } from "../Managers";
import { createWorker } from "../Workers";

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

console.log("Total agents:", registry.count());
console.log("Boss:", registry.getByRole("boss"));
console.log("Managers:", registry.getByRole("manager"));
console.log("Workers:", registry.getByRole("worker"));
console.log("Manager's workers:", registry.getChildren(manager.id));
