import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";
import type {
  Evidence,
  EvidenceType,
} from "../../verification/Evidence";
import { EvidenceService } from "../../verification/Evidence";

import { EventBus } from "../../messaging/EventBus";

export interface ExecutionResult {
  success: boolean;
  output: string;
  evidence: {
    type: EvidenceType;
    title: string;
    description: string;
    reference: string;
  } | null;
}

export interface ExecutionRecord {
  taskId: string;
  agentId: string;
  status: "started" | "completed" | "failed";
  output: string | null;
  evidenceId: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ExecutionEvents {
  [eventName: string]: unknown;

  "execution.started": ExecutionRecord;
  "execution.evidence_created": Evidence;
  "execution.completed": ExecutionRecord;
  "execution.failed": ExecutionRecord;
}

export class ExecutionService {
  private readonly records = new Map<
    string,
    ExecutionRecord
  >();

  readonly events = new EventBus<ExecutionEvents>();

  constructor(
    private readonly evidenceService: EvidenceService
  ) {}

  start(
    task: Task,
    agent: Agent
  ): ExecutionRecord {
    if (!task.assignedTo) {
      throw new Error(
        "Task must be assigned before execution"
      );
    }

    if (task.assignedTo !== agent.id) {
      throw new Error(
        "Agent is not assigned to this task"
      );
    }

    if (task.status !== "in_progress") {
      throw new Error(
        "Task must be in progress before execution"
      );
    }

    if (this.records.has(task.id)) {
      throw new Error(
        `Execution already exists: ${task.id}`
      );
    }

    const record: ExecutionRecord = {
      taskId: task.id,
      agentId: agent.id,
      status: "started",
      output: null,
      evidenceId: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };

    this.records.set(task.id, record);
    this.events.emit("execution.started", record);

    return record;
  }

  execute(
    task: Task,
    agent: Agent,
    result: ExecutionResult
  ): ExecutionRecord {
    const existing = this.records.get(task.id);

    if (!existing) {
      throw new Error(
        `Execution not started: ${task.id}`
      );
    }

    if (existing.agentId !== agent.id) {
      throw new Error(
        "Agent does not own this execution"
      );
    }

    if (existing.status !== "started") {
      throw new Error(
        `Execution already resolved: ${task.id}`
      );
    }

    if (!result.output.trim()) {
      throw new Error(
        "Execution output is required"
      );
    }

    if (!result.success) {
      const failed: ExecutionRecord = {
        ...existing,
        status: "failed",
        output: result.output,
        completedAt: new Date().toISOString(),
      };

      this.records.set(task.id, failed);
      this.events.emit("execution.failed", failed);

      return failed;
    }

    let evidenceId: string | null = null;

    if (result.evidence) {
      const evidence = this.evidenceService.create(
        `evidence-${task.id}`,
        task.id,
        agent.id,
        result.evidence.type,
        result.evidence.title,
        result.evidence.description,
        result.evidence.reference
      );

      evidenceId = evidence.id;
      this.events.emit(
        "execution.evidence_created",
        evidence
      );
    }

    const completed: ExecutionRecord = {
      ...existing,
      status: "completed",
      output: result.output,
      evidenceId,
      completedAt: new Date().toISOString(),
    };

    this.records.set(task.id, completed);
    this.events.emit("execution.completed", completed);

    return completed;
  }

  get(taskId: string): ExecutionRecord | undefined {
    return this.records.get(taskId);
  }

  getAll(): ExecutionRecord[] {
    return Array.from(this.records.values());
  }
}
