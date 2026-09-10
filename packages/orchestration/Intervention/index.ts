import type { A2AMessage } from "../../messaging/A2A";
import { AgentMessageService } from "../../messaging/AgentMessages";
import { AgentRegistry } from "../../agents/AgentRegistry";
import { EscalationService } from "../Escalation";
import { EventBus } from "../../messaging/EventBus";

export type InterventionAction =
  | "resume_worker"
  | "send_instruction"
  | "request_update";

export interface InterventionRequest {
  id: string;
  escalationId: string;
  bossId: string;
  action: InterventionAction;
  instruction: string;
}

export interface InterventionRecord extends InterventionRequest {
  managerId: string;
  taskId: string;
  createdAt: string;
}

export interface InterventionResult {
  decision: "APPLIED" | "DENY";
  intervention: InterventionRecord | null;
  message: A2AMessage | null;
  reason: string;
}

export interface InterventionEvents {
  [eventName: string]: unknown;

  "intervention.created": InterventionRecord;
}

export class InterventionService {
  private readonly interventions = new Map<
    string,
    InterventionRecord
  >();

  readonly events = new EventBus<InterventionEvents>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly messages: AgentMessageService,
    private readonly escalations: EscalationService
  ) {}

  intervene(
    request: InterventionRequest
  ): InterventionResult {
    const boss = this.registry.get(request.bossId);

    if (!boss || boss.role !== "boss") {
      return this.deny("Caller is not a Boss agent");
    }

    const state = this.escalations.getState(
      request.escalationId
    );

    if (!state) {
      return this.deny(
        `Escalation not found: ${request.escalationId}`
      );
    }

    if (state.escalation.bossId !== request.bossId) {
      return this.deny(
        "Caller is not the Boss assigned to this escalation"
      );
    }

    if (state.approvalStatus !== "approved") {
      return this.deny(
        `Escalation is not approved: ${state.approvalStatus}`
      );
    }

    if (!request.instruction.trim()) {
      return this.deny("Intervention instruction is required");
    }

    if (this.interventions.has(request.id)) {
      return this.deny(
        `Intervention already exists: ${request.id}`
      );
    }

    const intervention: InterventionRecord = {
      ...request,
      managerId: state.escalation.managerId,
      taskId: state.escalation.taskId,
      createdAt: new Date().toISOString(),
    };

    this.interventions.set(request.id, intervention);
    this.events.emit("intervention.created", intervention);

    const message = this.messages.send({
      id: `msg-intervention-${request.id}`,
      fromAgentId: request.bossId,
      toAgentId: intervention.managerId,
      type: "notification",
      subject: `Boss intervention: ${request.action}`,
      content: request.instruction,
      taskId: intervention.taskId,
      priority: "high",
      createdAt: new Date().toISOString(),
    });

    return {
      decision: "APPLIED",
      intervention,
      message,
      reason: "Boss intervention applied and manager notified",
    };
  }

  get(interventionId: string): InterventionRecord | undefined {
    return this.interventions.get(interventionId);
  }

  getAll(): InterventionRecord[] {
    return Array.from(this.interventions.values());
  }

  private deny(reason: string): InterventionResult {
    return {
      decision: "DENY",
      intervention: null,
      message: null,
      reason,
    };
  }
}