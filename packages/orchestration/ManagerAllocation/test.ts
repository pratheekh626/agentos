import { AgentMessageService } from "../../messaging/AgentMessages";
import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";
import { OrganizationService } from "../../agents/Organization";
import { ConferenceRoomService } from "../../agents/ConferenceRoom";
import { ManagerAllocationService } from "./index";

const registry = new AgentRegistry();
const boss = createBoss("boss", "Boss");
const manager = createManager("manager", "Manager", boss.id);
const worker = createWorker("worker", "Worker", manager.id);
for (const agent of [boss, manager, worker]) registry.register(agent);
const organization = new OrganizationService(registry);
organization.createOrganization("org", "Org", boss.id, "now");
const messages = new AgentMessageService();
const conference = new ConferenceRoomService(registry, messages);
const meeting = conference.createMeeting({ id: "meeting", projectId: "project", calledBy: boss.id, participants: [manager.id], agenda: "Allocate" });
conference.startMeeting(meeting.id);
const decision = conference.createDecision({ id: "decision", meetingId: meeting.id, decidedBy: boss.id, decisionType: "ASSIGN_MANAGER", summary: "Own work", taskIds: ["task"], managerId: manager.id });
const tasks = new Map([[
  "task",
  { id: "task", title: "Task", description: "Work", assignedTo: null, createdBy: boss.id, status: "queued" as const, priority: "high" as const, dependencies: [], budget: 0, spent: 0, createdAt: "now", updatedAt: "now" },
]]);
const allocation = new ManagerAllocationService(registry, organization, conference, {} as never, messages);
const created = allocation.createAllocation({ id: "allocation", organizationId: "org", meetingId: meeting.id, decisionId: decision.id, projectId: "project", managerId: manager.id, taskIds: ["task"], assignedBy: boss.id }, tasks);
if (created.decision !== "CREATED") throw new Error("Expected allocation creation");
if (allocation.activateAllocation("allocation", tasks).decision !== "REJECTED") throw new Error("Activation before approval should reject");
if (allocation.approveAllocation("allocation", boss.id).decision !== "APPROVED") throw new Error("Expected approval");
console.log("Manager allocation tests passed.");
