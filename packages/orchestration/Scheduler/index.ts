import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";
import type { AgentRegistry } from "../../agents/AgentRegistry";
import { DependencyManager } from "../Dependencies";
import {
  DelegationService,
  type DelegationResult,
} from "../Delegation";

export interface ScheduleResult {
  decision:
    | "SCHEDULED"
    | "BLOCKED"
    | "ESCALATE"
    | "DENY"
    | "NO_WORKER";
  task: Task | null;
  agent: Agent | null;
  approvalRequestId: string | null;
  reason: string;
}

export class Scheduler {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly dependencyManager: DependencyManager,
    private readonly delegationService: DelegationService
  ) {}

  schedule(
    tasks: Map<string, Task>,
    manager: Agent,
    riskScore = 0
  ): ScheduleResult {
    const queuedTasks = Array.from(tasks.values())
      .filter((task) => task.status === "queued")
      .sort((a, b) => {
        const priority = {
          critical: 4,
          high: 3,
          medium: 2,
          low: 1,
        };

        return priority[b.priority] - priority[a.priority];
      });

    for (const task of queuedTasks) {
      if (
        this.dependencyManager.hasCircularDependency(
          task,
          tasks
        )
      ) {
        continue;
      }

      if (
        !this.dependencyManager.canStart(
          task,
          tasks
        )
      ) {
        continue;
      }

      const worker =
        this.findEligibleWorker();

      if (!worker) {
        return {
          decision: "NO_WORKER",
          task,
          agent: null,
          approvalRequestId: null,
          reason:
            "No eligible worker is currently available",
        };
      }

      const delegation: DelegationResult =
        this.delegationService.delegate(
          manager,
          worker,
          task,
          riskScore
        );

      if (delegation.decision === "ALLOW") {
        return {
          decision: "SCHEDULED",
          task: delegation.task,
          agent: worker,
          approvalRequestId: null,
          reason: delegation.reason,
        };
      }

      if (delegation.decision === "ESCALATE") {
        return {
          decision: "ESCALATE",
          task,
          agent: worker,
          approvalRequestId:
            delegation.approvalRequestId,
          reason: delegation.reason,
        };
      }

      return {
        decision: "DENY",
        task,
        agent: worker,
        approvalRequestId: null,
        reason: delegation.reason,
      };
    }

    return {
      decision: "BLOCKED",
      task: null,
      agent: null,
      approvalRequestId: null,
      reason:
        "No queued task is currently ready to run",
    };
  }

  private findEligibleWorker(): Agent | null {
    const workers =
      this.registry.getByRole("worker");

    return (
      workers.find(
        (worker) => worker.status === "idle"
      ) ?? null
    );
  }
}
