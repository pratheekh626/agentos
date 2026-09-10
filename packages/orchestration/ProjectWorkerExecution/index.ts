import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";
import type { AgentRuntime } from "../../agents/Runtime";
import {
  ExecutionService,
  type ExecutionRecord,
  type ExecutionResult,
} from "../../agents/Execution";

export interface ProjectWorkerExecutionResult {
  decision: "EXECUTED" | "REJECTED";
  task: Task | null;
  execution: ExecutionRecord | null;
  reason: string;
}

export class ProjectWorkerExecutionService {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly execution: ExecutionService
  ) {}

  execute(
    task: Task,
    worker: Agent,
    result: ExecutionResult
  ): ProjectWorkerExecutionResult {
    const registeredWorker = this.runtime.getAgent(worker.id);

    if (!registeredWorker || registeredWorker.role !== "worker") {
      return this.rejected("Worker is not registered");
    }

    if (!task.assignedTo) {
      return this.rejected("Task must be assigned before execution");
    }

    if (task.assignedTo !== worker.id) {
      return this.rejected("Worker does not own this task");
    }

    if (
      task.status !== "assigned" &&
      task.status !== "in_progress"
    ) {
      return this.rejected(
        "Task must be assigned or in progress before execution"
      );
    }

    const started = this.runtime.startTask(task);
    const record = this.execution.start(started, worker);
    const completed = this.execution.execute(
      started,
      worker,
      result
    );

    return {
      decision: "EXECUTED",
      task: started,
      execution: completed,
      reason: "Worker execution completed through canonical execution service",
    };
  }

  private rejected(reason: string): ProjectWorkerExecutionResult {
    return {
      decision: "REJECTED",
      task: null,
      execution: null,
      reason,
    };
  }
}