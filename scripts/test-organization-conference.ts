import { AgentMessageService } from "../packages/messaging/AgentMessages";
import { AgentRegistry } from "../packages/agents/AgentRegistry";
import { createBoss } from "../packages/agents/Boss";
import { createManager } from "../packages/agents/Managers";
import { createWorker } from "../packages/agents/Workers";
import { OrganizationService } from "../packages/agents/Organization";
import { ConferenceRoomService } from "../packages/agents/ConferenceRoom";
import { AuditLedger } from "../packages/audit/AuditLedger";
import { AuditEventBridge } from "../packages/audit/EventBridge";
import { EventBus } from "../packages/messaging/EventBus";
import type { ExecutionEvents } from "../packages/agents/Execution";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const managers = [
  createManager("manager-a", "Frontend Manager", boss.id),
  createManager("manager-b", "Backend Manager", boss.id),
];
const workers = [
  createWorker("worker-a1", "Frontend One", managers[0].id),
  createWorker("worker-a2", "Frontend Two", managers[0].id),
  createWorker("worker-b1", "Backend One", managers[1].id),
  createWorker("worker-b2", "Backend Two", managers[1].id),
];
for (const agent of [boss, ...managers, ...workers]) registry.register(agent);

const organization = new OrganizationService(registry);
organization.createOrganization("org-e2e", "AGENTOS", boss.id, "2026-09-11T00:00:00.000Z");
for (const manager of managers) organization.addManager(manager.id, "research");
for (const worker of workers) organization.addWorker(worker.id, "frontend");
if (organization.getManagers().length !== 2 || organization.getWorkers().length !== 4) throw new Error("Organization roster failed");

const messages = new AgentMessageService();
const ledger = new AuditLedger();
const executionBus = new EventBus<ExecutionEvents>();
const audit = new AuditEventBridge(ledger, executionBus);
const conference = new ConferenceRoomService(registry, messages);
const conferenceAudit = new AuditEventBridge(
  ledger,
  executionBus,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  conference.events
);
let lifecycleEvents = 0;
conference.events.on("meeting.created", () => { lifecycleEvents += 1; });
conference.events.on("meeting.started", () => { lifecycleEvents += 1; });
conference.events.on("meeting.message_sent", () => { lifecycleEvents += 1; });
conference.events.on("meeting.decision_created", () => { lifecycleEvents += 1; });
conference.events.on("meeting.completed", () => { lifecycleEvents += 1; });

const meeting = conference.createMeeting({
  id: "meeting-e2e",
  projectId: "project-e2e",
  calledBy: boss.id,
  participants: managers.map((manager) => manager.id),
  agenda: "Allocate project responsibilities",
  createdAt: "2026-09-11T00:00:00.000Z",
});
conference.startMeeting(meeting.id);
conference.sendMessage(meeting.id, boss.id, managers[0].id, "Frontend plan", "Own frontend allocation.");
conference.sendMessage(meeting.id, boss.id, managers[1].id, "Backend plan", "Own backend allocation.");
conference.createDecision({
  id: "decision-e2e",
  meetingId: meeting.id,
  decidedBy: boss.id,
  decisionType: "ASSIGN_MANAGER",
  summary: "Managers own their departments",
  taskIds: [],
  managerId: managers[0].id,
  createdAt: "2026-09-11T00:00:01.000Z",
});
conference.completeMeeting(meeting.id);

if (
  lifecycleEvents !== 6 ||
  messages.getAll().length !== 2 ||
  ledger.getByType("MEETING_CREATED").length !== 1 ||
  ledger.getByType("MEETING_DECISION_CREATED").length !== 1 ||
  ledger.getByType("MEETING_COMPLETED").length !== 1 ||
  !ledger.verifyIntegrity()
) {
  throw new Error("Organization conference integration failed");
}

console.log("Organization conference integration passed.");
console.log(`Meeting: ${meeting.id}`);
console.log(`Decision: decision-e2e`);
console.log(`Messages: ${messages.getAll().length}`);
console.log("Governed task assignment remains owned by Runtime/Scheduler/Delegation.");
audit.disconnect();
conferenceAudit.disconnect();