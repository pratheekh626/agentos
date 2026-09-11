import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";
import type { AgentRegistry } from "../../agents/AgentRegistry";
import type { OrganizationService } from "../../agents/Organization";
import type { ConferenceRoomService, MeetingDecision } from "../../agents/ConferenceRoom";
import type { AgentRuntime } from "../../agents/Runtime";
import { AgentMessageService } from "../../messaging/AgentMessages";
import { EventBus } from "../../messaging/EventBus";

export type ManagerAllocationStatus =
  | "PROPOSED"
  | "APPROVED"
  | "ACTIVE"
  | "COMPLETED"
  | "REJECTED";

export interface ManagerAllocation {
  id: string;
  organizationId: string;
  meetingId: string;
  decisionId: string;
  projectId: string;
  managerId: string;
  taskIds: string[];
  assignedBy: string;
  status: ManagerAllocationStatus;
  createdAt: string;
}

export interface AllocationEvents {
  [eventName: string]: unknown;
  "allocation.created": ManagerAllocation;
  "allocation.approved": ManagerAllocation;
  "allocation.activated": ManagerAllocation;
  "allocation.rejected": ManagerAllocation;
}

export interface AllocationResult {
  decision: "CREATED" | "APPROVED" | "ACTIVATED" | "REJECTED";
  allocation: ManagerAllocation | null;
  scheduledTasks: Task[];
  reason: string;
}

export interface CreateAllocationInput {
  id: string;
  organizationId: string;
  meetingId: string;
  decisionId: string;
  projectId: string;
  managerId: string;
  taskIds: string[];
  assignedBy: string;
  createdAt?: string;
}

export class ManagerAllocationService {
  readonly events = new EventBus<AllocationEvents>();
  private readonly allocations = new Map<string, ManagerAllocation>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly organization: OrganizationService,
    private readonly conference: ConferenceRoomService,
    private readonly runtime: AgentRuntime,
    private readonly messages: AgentMessageService
  ) {}

  createAllocation(
    input: CreateAllocationInput,
    tasks: Map<string, Task>
  ): AllocationResult {
    const error = this.validateCreation(input, tasks);
    if (error) return this.rejected(error);
    if (this.allocations.has(input.id)) {
      return this.rejected(`Allocation already exists: ${input.id}`);
    }

    const allocation: ManagerAllocation = {
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
      status: "PROPOSED",
    };
    this.allocations.set(allocation.id, allocation);
    this.events.emit("allocation.created", allocation);
    return {
      decision: "CREATED",
      allocation,
      scheduledTasks: [],
      reason: "Manager allocation proposed",
    };
  }

  approveAllocation(
    allocationId: string,
    bossId: string
  ): AllocationResult {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) return this.rejected("Allocation not found");
    const boss = this.registry.get(bossId);
    if (!boss || boss.role !== "boss" || bossId !== allocation.assignedBy) {
      return this.rejected("Only the assigned Boss can approve allocation");
    }
    if (allocation.status !== "PROPOSED") {
      return this.rejected("Allocation is not awaiting approval");
    }
    const updated = { ...allocation, status: "APPROVED" as const };
    this.allocations.set(allocationId, updated);
    this.events.emit("allocation.approved", updated);
    this.messages.send({
      id: `msg-allocation-approved-${allocationId}`,
      fromAgentId: bossId,
      toAgentId: allocation.managerId,
      type: "notification",
      subject: "Manager allocation approved",
      content: "Boss allocated project task responsibility to you.",
      taskId: allocation.taskIds[0] ?? null,
      priority: "high",
      createdAt: new Date().toISOString(),
    });
    return { decision: "APPROVED", allocation: updated, scheduledTasks: [], reason: "Allocation approved" };
  }

  activateAllocation(
    allocationId: string,
    tasks: Map<string, Task>,
    riskScore = 0
  ): AllocationResult {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) return this.rejected("Allocation not found");
    if (allocation.status !== "APPROVED") return this.rejected("Allocation must be approved before activation");
    const manager = this.registry.get(allocation.managerId);
    if (!manager || manager.role !== "manager") return this.rejected("Manager is not registered");
    if (manager.status === "paused" || manager.status === "offline") return this.rejected("Manager is unavailable");
    if (allocation.taskIds.some((taskId) => !tasks.has(taskId))) return this.rejected("Allocation references a missing task");

    const scheduledTasks: Task[] = [];
    for (const taskId of allocation.taskIds) {
      const result = this.runtime.schedule(tasks, manager, riskScore);
      if (result.decision !== "SCHEDULED" || !result.task) {
        return this.rejected(`Allocation scheduling stopped: ${result.reason}`);
      }
      tasks.set(result.task.id, result.task);
      scheduledTasks.push(result.task);
      if (result.task.id === taskId) continue;
    }
    const updated = { ...allocation, status: "ACTIVE" as const };
    this.allocations.set(allocationId, updated);
    this.events.emit("allocation.activated", updated);
    this.messages.send({
      id: `msg-allocation-activated-${allocationId}`,
      fromAgentId: manager.id,
      toAgentId: manager.id,
      type: "notification",
      subject: "Manager allocation active",
      content: "Your allocated project responsibility is active.",
      taskId: allocation.taskIds[0] ?? null,
      priority: "high",
      createdAt: new Date().toISOString(),
    });
    return { decision: "ACTIVATED", allocation: updated, scheduledTasks, reason: "Allocation activated through governed scheduling" };
  }

  get(id: string): ManagerAllocation | undefined { return this.allocations.get(id); }
  getAll(): ManagerAllocation[] { return Array.from(this.allocations.values()); }

  private validateCreation(input: CreateAllocationInput, tasks: Map<string, Task>): string | null {
    if (!input.id.trim() || !input.organizationId.trim() || !input.projectId.trim()) return "Allocation identifiers are required";
    const boss = this.registry.get(input.assignedBy);
    const manager = this.registry.get(input.managerId);
    const org = this.organization.getOrganization();
    const meeting = this.conference.getMeeting(input.meetingId);
    const decision = this.conference.getDecision(input.decisionId) as MeetingDecision | undefined;
    if (!boss || boss.role !== "boss") return "Assigned actor must be a Boss";
    if (!org || org.id !== input.organizationId || org.bossId !== boss.id) return "Organization does not belong to Boss";
    if (!meeting || meeting.id !== input.meetingId || meeting.projectId !== input.projectId) return "Meeting is invalid for project";
    if (!decision || decision.meetingId !== meeting.id || decision.decidedBy !== boss.id) return "Decision provenance is invalid";
    if (decision.decisionType !== "ASSIGN_MANAGER" && decision.decisionType !== "APPROVE_ALLOCATION") return "Decision type cannot create allocation";
    if (!manager || manager.role !== "manager" || manager.managerId !== boss.id) return "Manager is outside Boss hierarchy";
    if (!input.taskIds.length || input.taskIds.some((id) => !tasks.has(id))) return "Allocation task IDs are invalid";
    return null;
  }

  private rejected(reason: string): AllocationResult {
    return { decision: "REJECTED", allocation: null, scheduledTasks: [], reason };
  }
}