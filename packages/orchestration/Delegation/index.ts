import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";
import type { AgentRegistry } from "../../agents/AgentRegistry";

import {
  DelegationFirewall,
} from "../../governance/DelegationFirewall";

import {
  ApprovalEngine,
} from "../../governance/ApprovalEngine";

import {
  TaskDispatcher,
} from "../TaskDispatcher";

export interface DelegationResult {
  decision: "ALLOW" | "DENY" | "ESCALATE";
  task: Task | null;
  approvalRequestId: string | null;
  reason: string;
}

export class DelegationService {
  private pendingDelegations = new Map<
    string,
    {
      from: Agent;
      to: Agent;
      task: Task;
    }
  >();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly firewall: DelegationFirewall,
    private readonly approvalEngine: ApprovalEngine,
    private readonly taskDispatcher: TaskDispatcher
  ) {}

  delegate(
    from: Agent,
    to: Agent,
    task: Task,
    riskScore: number
  ): DelegationResult {
    const policy = this.firewall.evaluate({
      from,
      to,
      taskId: task.id,
      riskScore,
    });

    if (policy.decision === "DENY") {
      return {
        decision: "DENY",
        task: null,
        approvalRequestId: null,
        reason: policy.reason,
      };
    }

    if (policy.decision === "ESCALATE") {
      const approval = this.approvalEngine.createRequest(
        `approval-${task.id}`,
        from.id,
        "delegate",
        policy.reason
      );

      this.pendingDelegations.set(approval.id, {
        from,
        to,
        task,
      });

      return {
        decision: "ESCALATE",
        task: null,
        approvalRequestId: approval.id,
        reason: policy.reason,
      };
    }

    const assignedTask =
      this.taskDispatcher.assignTask(
        task,
        to.id
      );

    return {
      decision: "ALLOW",
      task: assignedTask,
      approvalRequestId: null,
      reason: policy.reason,
    };
  }

  approveDelegation(
    approvalRequestId: string,
    approvedBy: string
  ): DelegationResult {
    const approval =
      this.approvalEngine.approve(
        approvalRequestId,
        approvedBy
      );

    if (approval.status !== "approved") {
      throw new Error(
        `Delegation approval failed: ${approvalRequestId}`
      );
    }

    const pending =
      this.pendingDelegations.get(
        approvalRequestId
      );

    if (!pending) {
      throw new Error(
        `Pending delegation not found: ${approvalRequestId}`
      );
    }

    const assignedTask =
      this.taskDispatcher.assignTask(
        pending.task,
        pending.to.id
      );

    this.pendingDelegations.delete(
      approvalRequestId
    );

    return {
      decision: "ALLOW",
      task: assignedTask,
      approvalRequestId,
      reason: "Delegation approved by authorized approver",
    };
  }

  rejectDelegation(
    approvalRequestId: string,
    rejectedBy: string
  ): DelegationResult {
    const approval =
      this.approvalEngine.reject(
        approvalRequestId,
        rejectedBy
      );

    this.pendingDelegations.delete(
      approvalRequestId
    );

    return {
      decision: "DENY",
      task: null,
      approvalRequestId,
      reason:
        approval.status === "rejected"
          ? "Delegation rejected by authorized approver"
          : "Delegation rejected",
    };
  }
}
