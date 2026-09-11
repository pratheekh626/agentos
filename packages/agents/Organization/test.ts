import { AgentRegistry } from "../AgentRegistry";
import { createBoss } from "../Boss";
import { createManager } from "../Managers";
import { createWorker } from "../Workers";
import { OrganizationService } from "./index";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const managerA = createManager("manager-a", "Frontend", boss.id);
const managerB = createManager("manager-b", "Backend", boss.id);
const workerA = createWorker("worker-a", "Worker A", managerA.id);
const workerB = createWorker("worker-b", "Worker B", managerB.id);
const workerC = createWorker("worker-c", "Worker C", managerA.id);

for (const agent of [boss, managerA, managerB, workerA, workerB, workerC]) {
  registry.register(agent);
}

const organization = new OrganizationService(registry);
organization.createOrganization("org-001", "AGENTOS", boss.id, "now");
organization.addManager(managerA.id, "frontend");
organization.addManager(managerB.id, "backend");
organization.addWorker(workerA.id, "frontend");
organization.addWorker(workerB.id, "backend");
organization.addWorker(workerC.id, "frontend");

if (organization.getBoss()?.id !== boss.id) throw new Error("Boss lookup failed");
if (organization.getManagers().length !== 2) throw new Error("Manager lookup failed");
if (organization.getWorkers().length !== 3) throw new Error("Worker lookup failed");
if (organization.getWorkersForManager(managerA.id).length !== 2) throw new Error("Manager roster failed");
if (organization.getManagerForWorker(workerB.id)?.id !== managerB.id) throw new Error("Worker manager lookup failed");

const tasks = new Map();
const workload = organization.getAgentWorkload(workerA.id, tasks);
if (!workload || workload.currentTaskCount !== 0) throw new Error("Workload lookup failed");
if (organization.getAvailableWorkers(tasks).length !== 3) throw new Error("Available worker lookup failed");

organization.updateAgentAvailability(workerA.id, "paused");
organization.updateAgentAvailability(workerB.id, "offline");
if (organization.getAvailableWorkers(tasks).length !== 1) throw new Error("Unavailable workers were reported");

console.log("Organization tests passed.");