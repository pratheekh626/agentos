import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";
import type { A2AMessage } from "../../messaging/A2A";
import { AgentMessageService } from "../../messaging/AgentMessages";
import { AgentRegistry } from "../../agents/AgentRegistry";
import { EventBus } from "../../messaging/EventBus";
import { TaskDispatcher } from "../TaskDispatcher";
import { DelegationService } from "../Delegation";

export interface RecoveryRecord {
  id: string;
  taskId: string;
  failedAgentId: string;
  reason: string;
  attempt: number;
  action: "retry" | "reassign";
  status: "pending" | "recovered" | "failed";
  createdAt: string;
}

export interface RecoveryResult {
  decision: "RECOVERED" | "FAILED" | "DENY";
  recovery: RecoveryRecord | null;
  task: Task | null;
  agent: Agent | null;
  message: A2AMessage | null;
  reason: string;
}

export interface RecoveryEvents {
  [eventName: string]: unknown;

  "recovery.attempted": RecoveryRecord;
  "recovery.succeeded": RecoveryRecord;
  "recovery.failed": RecoveryRecord;
}

export class RecoveryService {
  private readonly records = new Map<string, RecoveryRecord>();
  private readonly attempts = new Map<string, number>();

  readonly events = new EventBus<RecoveryEvents>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly taskDispatcher: TaskDispatcher,
    private readonly delegationService: DelegationService,
    private readonly messages: AgentMessageService,
    private readonly maxRetries = 2
  ) {}

  recover(
    task: Task,
    managerId: string,
    reason: string,
    riskScore = 0
  ): RecoveryResult {
    const manager = this.registry.get(managerId);
    const failedAgentId = task.assignedTo;

    if (!manager || manager.role !== "manager") {
      return this.deny("Recovery manager is not a registered manager");
    }

    if (!failedAgentId) {
      return this.deny("Task has no assigned worker");
    }

    const failedAgent = this.registry.get(failedAgentId);

    if (!failedAgent) {
      return this.deny(`Failed agent not found: ${failedAgentId}`);
    }

    if (failedAgent.role === "boss") {
      return this.deny("Boss agents cannot be recovered as workers");
    }

    if (!reason.trim()) {
      return this.deny("Recovery reason is required");
    }

    if (failedAgent.managerId !== managerId) {
      return this.deny("Manager does not own the failed worker");
    }

    const attempt = (this.attempts.get(task.id) ?? 0) + 1;
    this.attempts.set(task.id, attempt);

    const retryRecord = this.createRecord(
      task,
      failedAgentId,
      reason,
      attempt,
      "retry"
    );

    if (attempt > this.maxRetries) {
      return this.finishFailure(
        retryRecord,
        task,
        managerId,
        "Maximum recovery attempts exhausted"
      );
    }

    if (
      failedAgent.status !== "paused" &&
      failedAgent.status !== "offline"
    ) {
      const retriedTask = this.taskDispatcher.startTask(task);

      retryRecord.status = "recovered";
      this.records.set(retryRecord.id, retryRecord);

      return this.finishSuccess(
        retryRecord,
        retriedTask,
        failedAgent,
        managerId,
        "Task retry started on the existing worker"
      );
    }

    const replacement = this.registry
      .getByRole("worker")
      .find(
        (worker) =>
          worker.id !== failedAgentId &&
          worker.managerId === managerId &&
          worker.status === "idle"
      );

    if (!replacement) {
      return this.finishFailure(
        retryRecord,
        task,
        managerId,
        "No eligible replacement worker is available"
      );
    }

    const reassignment = this.delegationService.delegate(
      manager,
      replacement,
      task,
      riskScore
    );

    if (
      reassignment.decision !== "ALLOW" ||
      !reassignment.task
    ) {
      return this.finishFailure(
        {
          ...retryRecord,
          action: "reassign",
        },
        task,
        managerId,
        `Replacement delegation was not allowed: ${reassignment.reason}`
      );
    }

    const reassignedRecord: RecoveryRecord = {
      ...retryRecord,
      action: "reassign",
      status: "recovered",
    };

    this.records.set(reassignedRecord.id, reassignedRecord);

    return this.finishSuccess(
      reassignedRecord,
      reassignment.task,
      replacement,
      managerId,
      "Task reassigned through governed delegation"
    );
  }

  get(recoveryId: string): RecoveryRecord | undefined {
    return this.records.get(recoveryId);
  }

  getAll(): RecoveryRecord[] {
    return Array.from(this.records.values());
  }

  private createRecord(
    task: Task,
    failedAgentId: string,
    reason: string,
    attempt: number,
    action: RecoveryRecord["action"]
  ): RecoveryRecord {
    const record: RecoveryRecord = {
      id: `recovery-${task.id}-${attempt}`,
      taskId: task.id,
      failedAgentId,
      reason,
      attempt,
      action,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.records.set(record.id, record);
    this.events.emit("recovery.attempted", record);

    return record;
  }

  private finishSuccess(
    recovery: RecoveryRecord,
    task: Task,
    agent: Agent,
    managerId: string,
    reason: string
  ): RecoveryResult {
    const message = this.sendManagerMessage(
      recovery,
      managerId,
      `Recovery succeeded: ${recovery.action}`,
      reason
    );

    this.events.emit("recovery.succeeded", recovery);

    return {
      decision: "RECOVERED",
      recovery,
      task,
      agent,
      message,
      reason,
    };
  }

  private finishFailure(
    recovery: RecoveryRecord,
    task: Task,
    managerId: string,
    reason: string
  ): RecoveryResult {
    recovery.status = "failed";
    this.records.set(recovery.id, recovery);

    const message = this.sendManagerMessage(
      recovery,
      managerId,
      `Recovery failed: ${recovery.action}`,
      reason
    );

    this.events.emit("recovery.failed", recovery);

    return {
      decision: "FAILED",
      recovery,
      task,
      agent: null,
      message,
      reason,
    };
  }

  private sendManagerMessage(
    recovery: RecoveryRecord,
    managerId: string,
    subject: string,
    content: string
  ): A2AMessage {
    return this.messages.send({
      id: `msg-${recovery.id}`,
      fromAgentId: recovery.failedAgentId,
      toAgentId: managerId,
      type: "notification",
      subject,
      content,
      taskId: recovery.taskId,
      priority: "high",
      createdAt: new Date().toISOString(),
    });
  }

  private deny(reason: string): RecoveryResult {
    return {
      decision: "DENY",
      recovery: null,
      task: null,
      agent: null,
      message: null,
      reason,
    };
  }
}