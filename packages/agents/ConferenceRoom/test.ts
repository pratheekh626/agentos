import { AgentMessageService } from "../../messaging/AgentMessages";
import { AgentRegistry } from "../AgentRegistry";
import { createBoss } from "../Boss";
import { createManager } from "../Managers";
import { createWorker } from "../Workers";
import { ConferenceRoomService } from "./index";

const registry = new AgentRegistry();
const boss = createBoss("boss-001", "Boss");
const manager = createManager("manager-001", "Manager", boss.id);
const worker = createWorker("worker-001", "Worker", manager.id);
const outsider = createWorker("worker-002", "Outsider", "manager-002");
for (const agent of [boss, manager, worker, outsider]) registry.register(agent);

const messages = new AgentMessageService();
const conference = new ConferenceRoomService(registry, messages);
let created = false;
let decision = false;
conference.events.on("meeting.created", () => { created = true; });
conference.events.on("meeting.decision_created", () => { decision = true; });

const meeting = conference.createMeeting({
  id: "meeting-001",
  projectId: "project-001",
  calledBy: boss.id,
  participants: [manager.id],
  agenda: "Review project allocation",
  createdAt: "2026-09-11T00:00:00.000Z",
});
if (!created || meeting.status !== "SCHEDULED") throw new Error("Expected scheduled Boss meeting");
conference.startMeeting(meeting.id);
conference.sendMessage(meeting.id, boss.id, manager.id, "Request plan", "Give me the current plan.");
const meetingDecision = conference.createDecision({
  id: "decision-001",
  meetingId: meeting.id,
  decidedBy: boss.id,
  decisionType: "ASSIGN_MANAGER",
  summary: "Manager owns frontend allocation",
  taskIds: [],
  managerId: manager.id,
  createdAt: "2026-09-11T00:00:01.000Z",
});
if (!decision || meetingDecision.managerId !== manager.id) throw new Error("Expected meeting decision");
if (conference.completeMeeting(meeting.id).status !== "COMPLETED") throw new Error("Expected completed meeting");
if (messages.getAll().length !== 1) throw new Error("Expected A2A meeting message");

const managerMeeting = conference.createMeeting({
  id: "meeting-002",
  calledBy: manager.id,
  participants: [worker.id],
  agenda: "Worker status",
});
if (conference.startMeeting(managerMeeting.id).status !== "ACTIVE") throw new Error("Expected manager meeting");

try {
  conference.createMeeting({
    id: "meeting-invalid",
    calledBy: boss.id,
    participants: [outsider.id],
    agenda: "Invalid hierarchy",
  });
  throw new Error("Expected unrelated participant rejection");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("hierarchy")) throw error;
}

const cancelled = conference.createMeeting({
  id: "meeting-cancelled",
  calledBy: boss.id,
  participants: [manager.id],
  agenda: "Cancel this",
});
if (conference.cancelMeeting(cancelled.id).status !== "CANCELLED") throw new Error("Expected cancelled meeting");

console.log("Conference room tests passed.");