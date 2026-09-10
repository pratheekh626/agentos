import type { Agent } from "../../core/Agent";
import type { A2AMessage } from "../../messaging/A2A";
import { AgentMessageService } from "../../messaging/AgentMessages";
import { AgentRegistry } from "../../agents/AgentRegistry";
import {
  ApprovalEngine,
  type ApprovalRequest,
} from "../../governance/ApprovalEngine";

export interface EscalationRequest {
  id: string;
  managerId: string;
  bossId: string;
  taskId: string;
  reason: string;
}

export interface EscalationRecord extends EscalationRequest {
  createdAt: string;
  approvalRequestId: string;
}

export interface EscalationResult {
  decision: "PENDING" | "APPROVED" | "REJECTED" | "DENY";
  escalation: EscalationRecord | null;
  approval: ApprovalRequest | null;
  message: A2AMessage | null;
  reason: string;
}

export class EscalationService {
  private readonly escalations = new Map<
    string,
    EscalationRecord
  >();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly approvalEngine: ApprovalEngine,
    private readonly messages: AgentMessageService
  ) {}

  escalate(request: EscalationRequest): EscalationResult {
    const manager = this.registry.get(request.managerId);
    const boss = this.registry.get(request.bossId);

    if (!manager || manager.role !== "manager") {
      return this.deny("Only registered managers can escalate");
    }

    if (
      !boss ||
      boss.role !== "boss" ||
      manager.managerId !== boss.id
    ) {
      return this.deny(
        "Manager is not authorized to escalate to this Boss"
      );
    }

    if (!request.taskId.trim()) {
      return this.deny("Task ID is required");
    }

    if (!request.reason.trim()) {
      return this.deny("Escalation reason is required");
    }

    if (this.escalations.has(request.id)) {
      return this.deny(`Escalation already exists: ${request.id}`);
    }

    const approval = this.approvalEngine.createRequest(
      `approval-escalation-${request.id}`,
      manager.id,
      "escalate",
      request.reason
    );

    const escalation: EscalationRecord = {
      ...request,
      createdAt: new Date().toISOString(),
      approvalRequestId: approval.id,
    };

    this.escalations.set(request.id, escalation);

    const message = this.messages.send({
      id: `msg-escalation-${request.id}`,
      fromAgentId: manager.id,
      toAgentId: boss.id,
      type: "approval_request",
      subject: `Escalation requires decision: ${request.taskId}`,
      content: request.reason,
      taskId: request.taskId,
      priority: "high",
      createdAt: new Date().toISOString(),
    });

    return {
      decision: "PENDING",
      escalation,
      approval,
      message,
      reason: "Escalation submitted for Boss approval",
    };
  }

  approveEscalation(
    escalationId: string,
    approvedBy: string
  ): EscalationResult {
    const escalation = this.escalations.get(escalationId);

    if (!escalation) {
      return this.deny(
        `Escalation not found: ${escalationId}`
      );
    }

    if (approvedBy !== escalation.bossId) {
      return this.deny(
        "Only the assigned Boss can approve this escalation"
      );
    }

    const boss = this.registry.get(approvedBy);

    if (!boss || boss.role !== "boss") {
      return this.deny("Approver is not a Boss agent");
    }

    const approval = this.approvalEngine.approve(
      escalation.approvalRequestId,
      approvedBy
    );

    return {
      decision: "APPROVED",
      escalation,
      approval,
      message: this.messages.send({
        id: `msg-escalation-approved-${escalation.id}`,
        fromAgentId: approvedBy,
        toAgentId: escalation.managerId,
        type: "response",
        subject: "Escalation approved",
        content: approval.reason,
        taskId: escalation.taskId,
        priority: "high",
        createdAt: new Date().toISOString(),
      }),
      reason: "Escalation approved by authorized Boss",
    };
  }

  rejectEscalation(
    escalationId: string,
    rejectedBy: string
  ): EscalationResult {
    const escalation = this.escalations.get(escalationId);

    if (!escalation) {
      return this.deny(
        `Escalation not found: ${escalationId}`
      );
    }

    if (rejectedBy !== escalation.bossId) {
      return this.deny(
        "Only the assigned Boss can reject this escalation"
      );
    }

    const boss = this.registry.get(rejectedBy);

    if (!boss || boss.role !== "boss") {
      return this.deny("Approver is not a Boss agent");
    }

    const approval = this.approvalEngine.reject(
      escalation.approvalRequestId,
      rejectedBy
    );

    return {
      decision: "REJECTED",
      escalation,
      approval,
      message: this.messages.send({
        id: `msg-escalation-rejected-${escalation.id}`,
        fromAgentId: rejectedBy,
        toAgentId: escalation.managerId,
        type: "response",
        subject: "Escalation rejected",
        content: approval.reason,
        taskId: escalation.taskId,
        priority: "high",
        createdAt: new Date().toISOString(),
      }),
      reason: "Escalation rejected by authorized Boss",
    };
  }

  get(escalationId: string): EscalationRecord | undefined {
    return this.escalations.get(escalationId);
  }

  private deny(reason: string): EscalationResult {
    return {
      decision: "DENY",
      escalation: null,
      approval: null,
      message: null,
      reason,
    };
  }
}