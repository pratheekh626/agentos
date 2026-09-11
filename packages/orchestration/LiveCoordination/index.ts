import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";
import type { A2AMessage } from "../../messaging/A2A";
import type { AgentRegistry } from "../../agents/AgentRegistry";
import type { AgentRuntime } from "../../agents/Runtime";
import type { AgentMessageService } from "../../messaging/AgentMessages";
import type {
  ManagerAllocationService,
  ManagerAllocation,
} from "../ManagerAllocation";
import {
  ManagerTaskLifecycle,
  type DelegateResult,
  type MonitorResult,
  type BlockerResult,
} from "../ManagerTaskLifecycle";
import { EscalationService, type EscalationResult } from "../Escalation";
import {
  InterventionService,
  type InterventionResult,
  type InterventionAction,
} from "../Intervention";

export interface ProgressResult {
  decision: "SENT" | "REJECTED";
  message: A2AMessage | null;
  reason: string;
}

export interface BlockerReportResult {
  decision: "REPORTED" | "REJECTED";
  message: A2AMessage | null;
  reason: string;
}

export class LiveCoordinationService {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly allocationService: ManagerAllocationService,
    private readonly lifecycle: ManagerTaskLifecycle,
    private readonly runtime: AgentRuntime,
    private readonly messages: AgentMessageService,
    private readonly escalation: EscalationService,
    private readonly intervention: InterventionService
  ) {}

  /**
   * Governed Manager → Worker task delegation.
   */
  delegateSubtask(
    allocationId: string,
    managerId: string,
    task: Task,
    workerId: string,
    tasks: Map<string, Task>,
    riskScore = 0
  ): DelegateResult {
    return this.lifecycle.delegateAllocatedSubtask(
      allocationId,
      managerId,
      task,
      workerId,
      tasks,
      riskScore
    );
  }

  /**
   * Governed Worker → Manager progress update via A2A messaging.
   */
  sendWorkerProgress(
    workerId: string,
    managerId: string,
    taskId: string,
    allocationId: string,
    content: string,
    tasks: Map<string, Task>
  ): ProgressResult {
    const error = this.validateWorkerMessaging(
      workerId,
      managerId,
      taskId,
      allocationId,
      content,
      tasks
    );
    if (error) return { decision: "REJECTED", message: null, reason: error };

    const message = this.runtime.sendMessage({
      fromAgentId: workerId,
      toAgentId: managerId,
      type: "status_update",
      subject: `Progress update for ${taskId}`,
      content,
      taskId,
      priority: "medium",
    });

    return {
      decision: "SENT",
      message,
      reason: "Worker progress update sent to manager via A2A",
    };
  }

  /**
   * Manager retrieves worker progress updates within allocation scope.
   */
  getWorkerProgress(
    managerId: string,
    workerId: string,
    allocationId: string,
    tasks: Map<string, Task>
  ): MonitorResult {
    return this.lifecycle.monitorWorker(
      allocationId,
      managerId,
      workerId,
      tasks
    );
  }

  /**
   * Governed Worker → Manager blocker report via A2A messaging.
   */
  reportWorkerBlocker(
    workerId: string,
    managerId: string,
    taskId: string,
    allocationId: string,
    reason: string,
    tasks: Map<string, Task>
  ): BlockerReportResult {
    const error = this.validateWorkerMessaging(
      workerId,
      managerId,
      taskId,
      allocationId,
      reason,
      tasks
    );
    if (error) return { decision: "REJECTED", message: null, reason: error };

    const message = this.runtime.sendMessage({
      fromAgentId: workerId,
      toAgentId: managerId,
      type: "notification",
      subject: `Blocker reported for ${taskId}`,
      content: reason,
      taskId,
      priority: "high",
    });

    return {
      decision: "REPORTED",
      message,
      reason: "Worker reported blocker to manager via A2A",
    };
  }

  /**
   * Manager handles worker blocker via RecoveryService or EscalationService.
   */
  handleBlocker(
    allocationId: string,
    managerId: string,
    task: Task,
    reason: string,
    tasks: Map<string, Task>,
    riskScore = 0
  ): BlockerResult {
    return this.lifecycle.handleBlocker(
      allocationId,
      managerId,
      task,
      reason,
      tasks,
      riskScore
    );
  }

  /**
   * Boss approves escalation via EscalationService.
   */
  approveEscalation(
    bossId: string,
    escalationId: string
  ): EscalationResult {
    const boss = this.registry.get(bossId);
    if (!boss || boss.role !== "boss") {
      return {
        decision: "DENY",
        escalation: null,
        approval: null,
        message: null,
        reason: "Only a registered Boss can approve escalations",
      };
    }
    return this.escalation.approveEscalation(escalationId, bossId);
  }

  /**
   * Boss rejects escalation via EscalationService.
   */
  rejectEscalation(
    bossId: string,
    escalationId: string
  ): EscalationResult {
    const boss = this.registry.get(bossId);
    if (!boss || boss.role !== "boss") {
      return {
        decision: "DENY",
        escalation: null,
        approval: null,
        message: null,
        reason: "Only a registered Boss can reject escalations",
      };
    }
    return this.escalation.rejectEscalation(escalationId, bossId);
  }

  /**
   * Boss applies intervention via InterventionService.
   */
  applyBossIntervention(
    bossId: string,
    escalationId: string,
    interventionId: string,
    action: InterventionAction,
    instruction: string
  ): InterventionResult {
    const boss = this.registry.get(bossId);
    if (!boss || boss.role !== "boss") {
      return {
        decision: "DENY",
        intervention: null,
        message: null,
        reason: "Only a registered Boss can apply interventions",
      };
    }
    return this.intervention.intervene({
      id: interventionId,
      escalationId,
      bossId,
      action,
      instruction,
    });
  }

  /**
   * Manager retrieves intervention notifications.
   */
  getManagerInterventions(managerId: string): A2AMessage[] {
    const manager = this.registry.get(managerId);
    if (!manager || manager.role !== "manager") {
      return [];
    }
    return this.messages
      .getByAgent(managerId)
      .filter((msg) => msg.subject.startsWith("Boss intervention:"));
  }

  /**
   * Boss retrieves pending escalation notification messages.
   */
  getBossEscalationNotifications(bossId: string): A2AMessage[] {
    const boss = this.registry.get(bossId);
    if (!boss || boss.role !== "boss") {
      return [];
    }
    return this.messages
      .getByAgent(bossId)
      .filter((msg) => msg.type === "approval_request");
  }

  // ── Private validation helpers ──────────────────────────────────────────────

  private validateWorkerMessaging(
    workerId: string,
    managerId: string,
    taskId: string,
    allocationId: string,
    content: string,
    tasks: Map<string, Task>
  ): string | null {
    if (!content.trim()) return "Message content is required";
    const worker = this.registry.get(workerId);
    if (!worker || worker.role !== "worker") return "Worker is not registered";
    if (worker.managerId !== managerId) return "Worker does not belong to this manager";
    if (worker.status === "paused" || worker.status === "offline") {
      return "Worker is currently unavailable";
    }

    const allocation = this.allocationService.get(allocationId);
    if (!allocation || allocation.status !== "ACTIVE") {
      return "Allocation is not ACTIVE";
    }
    if (allocation.managerId !== managerId) {
      return "Manager does not own this allocation";
    }

    const authorizedIds = this.lifecycle.getAuthorizedTaskIds(
      allocationId,
      managerId,
      tasks
    );
    if (!authorizedIds.includes(taskId)) {
      return "Task is not authorized under this allocation";
    }

    return null;
  }
}
