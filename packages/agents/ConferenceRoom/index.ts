import type { Agent } from "../../core/Agent";
import type { A2AMessage } from "../../messaging/A2A";
import { AgentMessageService } from "../../messaging/AgentMessages";
import { EventBus } from "../../messaging/EventBus";
import { AgentRegistry } from "../AgentRegistry";

export type MeetingStatus = "SCHEDULED" | "ACTIVE" | "DECISION_PENDING" | "COMPLETED" | "CANCELLED";
export type MeetingDecisionType = "ASSIGN_MANAGER" | "REQUEST_STATUS" | "REQUEST_PLAN" | "APPROVE_ALLOCATION" | "REJECT_ALLOCATION" | "ESCALATE";

export interface Meeting {
  id: string;
  projectId: string | null;
  taskId: string | null;
  calledBy: string;
  participants: string[];
  agenda: string;
  status: MeetingStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MeetingDecision {
  id: string;
  meetingId: string;
  decidedBy: string;
  decisionType: MeetingDecisionType;
  summary: string;
  taskIds: string[];
  managerId: string | null;
  createdAt: string;
}

export interface ConferenceEvents {
  [eventName: string]: unknown;
  "meeting.created": Meeting;
  "meeting.started": Meeting;
  "meeting.message_sent": A2AMessage;
  "meeting.decision_created": MeetingDecision;
  "meeting.completed": Meeting;
  "meeting.cancelled": Meeting;
}

export interface CreateMeetingInput {
  id: string;
  projectId?: string | null;
  taskId?: string | null;
  calledBy: string;
  participants: string[];
  agenda: string;
  createdAt?: string;
}

export class ConferenceRoomService {
  readonly events = new EventBus<ConferenceEvents>();
  private readonly meetings = new Map<string, Meeting>();
  private readonly decisions = new Map<string, MeetingDecision>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly messages: AgentMessageService
  ) {}

  createMeeting(input: CreateMeetingInput): Meeting {
    const caller = this.registry.get(input.calledBy);
    if (!caller) throw new Error("Meeting caller is not registered");
    if (this.meetings.has(input.id)) throw new Error(`Meeting already exists: ${input.id}`);
    if (!input.participants.length) throw new Error("Meeting needs participants");
    if (!input.agenda.trim()) throw new Error("Meeting agenda is required");
    for (const participantId of input.participants) {
      const participant = this.registry.get(participantId);
      if (!participant) throw new Error(`Meeting participant is not registered: ${participantId}`);
      if (!this.canParticipate(caller, participant)) {
        throw new Error("Meeting participant is outside the caller hierarchy");
      }
    }

    const participants = Array.from(
      new Set([input.calledBy, ...input.participants])
    );
    const meeting: Meeting = {
      id: input.id,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      calledBy: input.calledBy,
      participants,
      agenda: input.agenda,
      status: "SCHEDULED",
      createdAt: input.createdAt ?? new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };
    this.meetings.set(meeting.id, meeting);
    this.events.emit("meeting.created", meeting);
    return meeting;
  }

  startMeeting(meetingId: string): Meeting {
    const meeting = this.requireMeeting(meetingId);
    if (meeting.status !== "SCHEDULED") throw new Error("Meeting is not scheduled");
    const updated = { ...meeting, status: "ACTIVE" as const, startedAt: new Date().toISOString() };
    this.meetings.set(meetingId, updated);
    this.events.emit("meeting.started", updated);
    return updated;
  }

  sendMessage(meetingId: string, fromAgentId: string, toAgentId: string, subject: string, content: string): A2AMessage {
    const meeting = this.requireMeeting(meetingId);
    if (meeting.status !== "ACTIVE") throw new Error("Meeting must be active");
    if (!meeting.participants.includes(fromAgentId) || !meeting.participants.includes(toAgentId)) {
      throw new Error("Meeting message participants are not in the meeting");
    }
    const message = this.messages.send({
      id: `meeting-${meetingId}-${Date.now()}`,
      fromAgentId,
      toAgentId,
      type: "request",
      subject,
      content,
      taskId: meeting.taskId,
      priority: "high",
      createdAt: new Date().toISOString(),
    });
    this.events.emit("meeting.message_sent", message);
    return message;
  }

  createDecision(input: Omit<MeetingDecision, "createdAt"> & { createdAt?: string }): MeetingDecision {
    const meeting = this.requireMeeting(input.meetingId);
    if (meeting.status !== "ACTIVE" && meeting.status !== "DECISION_PENDING") throw new Error("Meeting is not ready for a decision");
    if (!meeting.participants.includes(input.decidedBy)) throw new Error("Decision maker is not a participant");
    const decision: MeetingDecision = { ...input, createdAt: input.createdAt ?? new Date().toISOString() };
    this.decisions.set(decision.id, decision);
    const updated = { ...meeting, status: "DECISION_PENDING" as const };
    this.meetings.set(meeting.id, updated);
    this.events.emit("meeting.decision_created", decision);
    return decision;
  }

  completeMeeting(meetingId: string): Meeting {
    const meeting = this.requireMeeting(meetingId);
    if (meeting.status !== "DECISION_PENDING") throw new Error("Meeting needs a decision before completion");
    const updated = { ...meeting, status: "COMPLETED" as const, completedAt: new Date().toISOString() };
    this.meetings.set(meetingId, updated);
    this.events.emit("meeting.completed", updated);
    return updated;
  }

  cancelMeeting(meetingId: string): Meeting {
    const meeting = this.requireMeeting(meetingId);
    const updated = { ...meeting, status: "CANCELLED" as const, completedAt: new Date().toISOString() };
    this.meetings.set(meetingId, updated);
    this.events.emit("meeting.cancelled", updated);
    return updated;
  }

  getMeeting(meetingId: string): Meeting | undefined { return this.meetings.get(meetingId); }
  getDecision(decisionId: string): MeetingDecision | undefined { return this.decisions.get(decisionId); }

  private requireMeeting(meetingId: string): Meeting {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
    return meeting;
  }

  private canParticipate(caller: Agent, participant: Agent): boolean {
    if (caller.role === "boss") return participant.role === "manager";
    if (caller.role === "manager") return participant.role === "worker" && participant.managerId === caller.id;
    return false;
  }
}