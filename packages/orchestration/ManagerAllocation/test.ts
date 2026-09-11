import { AgentMessageService } from "../../messaging/AgentMessages";
import { AgentRegistry } from "../../agents/AgentRegistry";
import { createBoss } from "../../agents/Boss";
import { createManager } from "../../agents/Managers";
import { createWorker } from "../../agents/Workers";
import { OrganizationService } from "../../agents/Organization";
import { ConferenceRoomService } from "../../agents/ConferenceRoom";
import { ManagerAllocationService } from "./index";
import type { AgentRuntime } from "../../agents/Runtime";
import type { Task } from "../../core/Task";

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
], [
  "task-2",
  { id: "task-2", title: "Second task", description: "More work", assignedTo: null, createdBy: boss.id, status: "queued" as const, priority: "medium" as const, dependencies: [], budget: 0, spent: 0, createdAt: "now", updatedAt: "now" },
]]);
const runtime = {
  schedule(taskMap: Map<string, Task>) {
    const task = Array.from(taskMap.values())[0];
    if (!task) throw new Error("Task fixture missing");
    return {
      decision: "SCHEDULED" as const,
      task: {
        ...task,
        assignedTo: worker.id,
        status: "assigned" as const,
      },
      agent: worker,
      approvalRequestId: null,
      reason: "Test governed scheduling seam",
    };
  },
} as unknown as AgentRuntime;
const allocation = new ManagerAllocationService(registry, organization, conference, runtime, messages);
const created = allocation.createAllocation({ id: "allocation", organizationId: "org", meetingId: meeting.id, decisionId: decision.id, projectId: "project", managerId: manager.id, taskIds: ["task", "task-2"], assignedBy: boss.id }, tasks);
if (created.decision !== "CREATED") throw new Error("Expected allocation creation");
if (allocation.activateAllocation("allocation", tasks).decision !== "REJECTED") throw new Error("Activation before approval should reject");
if (allocation.approveAllocation("allocation", boss.id).decision !== "APPROVED") throw new Error("Expected approval");
if (allocation.getAuthorizedTasks("allocation", manager.id, tasks).length !== 0) throw new Error("Approved allocation should not expose tasks before activation");
if (allocation.activateAllocation("allocation", tasks).decision !== "ACTIVATED") throw new Error("Expected allocation activation");
if (allocation.getAuthorizedTasks("allocation", manager.id, tasks).length !== 2) throw new Error("Active allocation should expose only authorized tasks");
if (allocation.getAuthorizedTasks("allocation", "other-manager", tasks).length !== 0) throw new Error("Allocation exposed tasks to another manager");

// ── decomposeTaskIds tests ────────────────────────────────────────────────────

// Build a second meeting/decision for the decompose fixture
const decompMeeting = conference.createMeeting({ id: "meeting-decomp", projectId: "project-decomp", calledBy: boss.id, participants: [manager.id], agenda: "Decompose" });
conference.startMeeting(decompMeeting.id);
const decompDecision = conference.createDecision({ id: "decision-decomp", meetingId: decompMeeting.id, decidedBy: boss.id, decisionType: "ASSIGN_MANAGER", summary: "Decompose work", taskIds: ["task-exec", "task-decomp"], managerId: manager.id });
conference.completeMeeting(decompMeeting.id);

const decompTasks = new Map([
  ["task-exec",  { id: "task-exec",  title: "Exec",  description: "", assignedTo: null, createdBy: boss.id,    status: "queued" as const, priority: "high"   as const, dependencies: [], budget: 0, spent: 0, createdAt: "now", updatedAt: "now" }],
  ["task-decomp",{ id: "task-decomp",title: "Decomp",description: "", assignedTo: null, createdBy: manager.id, status: "queued" as const, priority: "medium" as const, dependencies: [], budget: 0, spent: 0, createdAt: "now", updatedAt: "now" }],
]);

// Validation: decomposeTaskIds must be a subset of taskIds
const badSubset = allocation.createAllocation(
  { id: "alloc-bad-subset", organizationId: "org", meetingId: decompMeeting.id, decisionId: decompDecision.id, projectId: "project-decomp", managerId: manager.id, taskIds: ["task-exec", "task-decomp"], decomposeTaskIds: ["task-nonexistent"], assignedBy: boss.id },
  decompTasks
);
if (badSubset.decision !== "REJECTED" || !badSubset.reason.includes("subset")) throw new Error("Expected rejection when decomposeTaskIds is not a subset of taskIds");

// Happy path: create allocation with decomposeTaskIds
const decompAlloc = allocation.createAllocation(
  { id: "alloc-decomp", organizationId: "org", meetingId: decompMeeting.id, decisionId: decompDecision.id, projectId: "project-decomp", managerId: manager.id, taskIds: ["task-exec", "task-decomp"], decomposeTaskIds: ["task-decomp"], assignedBy: boss.id },
  decompTasks
);
if (decompAlloc.decision !== "CREATED") throw new Error("Expected decompose allocation creation");
if (allocation.approveAllocation("alloc-decomp", boss.id).decision !== "APPROVED") throw new Error("Expected approval");

const decompActivated = allocation.activateAllocation("alloc-decomp", decompTasks);
if (decompActivated.decision !== "ACTIVATED") throw new Error("Expected activation with decomposeTaskIds");

// task-exec should have been scheduled (it is a worker-executable task)
if (decompActivated.scheduledTasks.length !== 1 || decompActivated.scheduledTasks[0].id !== "task-exec") {
  throw new Error("Expected only task-exec to be scheduled during activation");
}

// task-decomp must NOT be scheduled — it stays unassigned, ready for manager decomposition
const decompTaskState = decompTasks.get("task-decomp")!;
if (decompTaskState.assignedTo !== null) {
  throw new Error("task-decomp should NOT be assigned to a worker during activation");
}

// getAuthorizedTasks should still return both tasks (decomp task is still in the allocation)
const authTasks = allocation.getAuthorizedTasks("alloc-decomp", manager.id, decompTasks);
if (authTasks.length !== 2) throw new Error("Both tasks (exec + decomp) should be authorized after activation");
if (!authTasks.some(t => t.id === "task-decomp")) throw new Error("task-decomp should remain in authorized task set");

console.log("Manager allocation tests passed.");
