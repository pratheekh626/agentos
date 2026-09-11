import type { Agent } from "../../core/Agent";
import type { Task } from "../../core/Task";
import type { A2AMessage } from "../../messaging/A2A";
import type { AgentRegistry } from "../../agents/AgentRegistry";
import type { OrganizationService } from "../../agents/Organization";
import type { AgentRuntime, RuntimeSubtaskInput } from "../../agents/Runtime";
import type {
  ManagerAllocationService,
  ManagerAllocation,
} from "../ManagerAllocation";
import { DependencyManager } from "../Dependencies";
import { RecoveryService, type RecoveryResult } from "../Recovery";
import { EscalationService, type EscalationResult } from "../Escalation";

// ── Result types ──────────────────────────────────────────────────────────────

export interface DecomposeResult {
  decision: "DECOMPOSED" | "REJECTED";
  subtasks: Task[];
  reason: string;
}

export interface DelegateResult {
  decision: "DELEGATED" | "REJECTED";
  task: Task | null;
  worker: Agent | null;
  message: A2AMessage | null;
  reason: string;
}

export interface MonitorResult {
  decision: "OK" | "REJECTED";
  workerStatus: Agent["status"] | null;
  tasks: Task[];
  progressMessages: A2AMessage[];
  blockerMessages: A2AMessage[];
  reason: string;
}

export interface BlockerResult {
  decision: "RECOVERED" | "ESCALATED" | "FAILED" | "REJECTED";
  recovery: RecoveryResult | null;
  escalation: EscalationResult | null;
  reason: string;
}

// ── Internal auth helpers ─────────────────────────────────────────────────────

type AuthOk = { ok: true; allocation: ManagerAllocation; manager: Agent };
type AuthFail = { ok: false; reason: string };
type AuthResult = AuthOk | AuthFail;

// ── Coordinator ───────────────────────────────────────────────────────────────

/**
 * Thin coordinator for the governed manager → worker task lifecycle.
 *
 * Responsibilities:
 *  1. Gate every AgentRuntime operation behind ManagerAllocationService
 *     authorization (status === ACTIVE, correct managerId).
 *  2. Enforce that decomposition is only permitted on tasks the Boss explicitly
 *     listed in allocation.decomposeTaskIds — the coordinator does NOT grant
 *     itself authorization; the Boss must grant it at allocation-creation time.
 *  3. Track subtasks derived from authorized decompose parents in a
 *     coordinator-owned private set (no public addTask/authorizeTask API).
 *  4. Enforce DependencyManager.canStart() before delegating any subtask.
 *  5. Delegate to existing Runtime, RecoveryService, and EscalationService
 *     without duplicating their logic.
 *
 * NOTE: TASK_DECOMPOSED audit event is a known gap intentionally deferred to
 * a future audit milestone.
 */
export class ManagerTaskLifecycle {
  /**
   * Coordinator-owned record of subtasks derived from Boss-designated
   * decompose parents.  Maps allocationId → Set<taskId>.
   *
   * Only decomposeAllocatedTask() may write to this map.
   * There is no public "addTaskToAllocation" or "authorizeTask" API.
   */
  private readonly derivedSubtasks = new Map<string, Set<string>>();
  private counter = 0;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly organization: OrganizationService,
    private readonly allocationService: ManagerAllocationService,
    private readonly runtime: AgentRuntime,
    private readonly dependencyManager: DependencyManager,
    private readonly recovery: RecoveryService,
    private readonly escalation: EscalationService
  ) {}

  // ── Public lifecycle methods ────────────────────────────────────────────────

  /**
   * Decompose a Boss-designated parent task into governed subtasks.
   *
   * Authorization rules:
   *  1. Allocation must exist.
   *  2. allocation.status === "ACTIVE".
   *  3. managerId must own the allocation.
   *  4. Manager must be registered as a manager agent.
   *  5. task.id must be in allocation.taskIds.
   *  6. task.id must be in allocation.decomposeTaskIds — the Boss must have
   *     explicitly designated this task for manager decomposition.
   *
   * After authorization passes, delegates to Runtime.decomposeTask() unchanged.
   * Resulting subtasks are registered as derived and added to the task map.
   */
  decomposeAllocatedTask(
    allocationId: string,
    managerId: string,
    task: Task,
    subtaskInputs: RuntimeSubtaskInput[],
    tasks: Map<string, Task>
  ): DecomposeResult {
    const auth = this.resolveAuth(allocationId, managerId);
    if (!auth.ok) {
      return { decision: "REJECTED", subtasks: [], reason: auth.reason };
    }
    const { allocation, manager } = auth;

    // Rule 5: task must be in the allocation's task set
    if (!allocation.taskIds.includes(task.id)) {
      return {
        decision: "REJECTED",
        subtasks: [],
        reason: "Parent task is not part of this allocation",
      };
    }

    // Rule 6: task must be in the Boss-designated decompose set
    if (!allocation.decomposeTaskIds.includes(task.id)) {
      return {
        decision: "REJECTED",
        subtasks: [],
        reason:
          "Parent task was not designated for decomposition by the Boss " +
          "(not listed in allocation.decomposeTaskIds)",
      };
    }

    let subtasks: Task[];
    try {
      // Runtime.decomposeTask() authorization is unchanged:
      // task.createdBy === manager.id OR task.assignedTo === manager.id
      subtasks = this.runtime.decomposeTask(task, manager, subtaskInputs);
    } catch (err) {
      return {
        decision: "REJECTED",
        subtasks: [],
        reason: err instanceof Error ? err.message : "Decomposition failed",
      };
    }

    // Register derived subtasks. This is the only path that grants
    // allocation-scope authority to a new task ID.
    this.trackDerived(
      allocationId,
      subtasks.map((s) => s.id)
    );

    // Persist subtasks into the shared task map.
    for (const subtask of subtasks) {
      tasks.set(subtask.id, subtask);
    }

    return {
      decision: "DECOMPOSED",
      subtasks,
      reason: "Task decomposed into governed subtasks",
    };
  }

  /**
   * Delegate an allocation-authorized subtask to an eligible worker.
   *
   * Authorization rules:
   *  1–4. Allocation / manager auth (same as above).
   *  5.   Task must be original-authorized (allocation.taskIds) or
   *       coordinator-derived (derivedSubtasks).
   *  6.   Worker must belong to this manager (worker.managerId === managerId).
   *  7.   Worker must not be paused or offline.
   *  8.   OrganizationService availability + workload limit respected.
   *  9.   DependencyManager.canStart(task, tasks) must return true — all
   *       dependencies must be status "completed" before this task is assigned.
   *  10.  Assignment goes through Runtime.assignSubtask() → DelegationService
   *       → SecurityGateway → PermissionEngine/Policy.
   *       TaskDispatcher.assignTask() is never called directly.
   */
  delegateAllocatedSubtask(
    allocationId: string,
    managerId: string,
    task: Task,
    workerId: string,
    tasks: Map<string, Task>,
    riskScore = 0
  ): DelegateResult {
    const reject = (reason: string): DelegateResult => ({
      decision: "REJECTED",
      task: null,
      worker: null,
      message: null,
      reason,
    });

    const auth = this.resolveAuth(allocationId, managerId);
    if (!auth.ok) return reject(auth.reason);
    const { manager } = auth;

    if (!this.isAuthorized(allocationId, managerId, task.id, tasks)) {
      return reject("Task is not authorized by this allocation");
    }

    // Worker selection: org hierarchy + availability + workload
    const worker = this.registry.get(workerId);
    if (!worker || worker.role !== "worker") {
      return reject("Worker is not registered");
    }
    if (worker.managerId !== managerId) {
      return reject("Worker does not belong to this manager");
    }
    if (worker.status === "paused" || worker.status === "offline") {
      return reject("Worker is unavailable");
    }

    const profile = this.organization.getAgentWorkload(workerId, tasks);
    if (!profile) {
      return reject("Worker has no organization profile");
    }
    if (
      profile.availability === "paused" ||
      profile.availability === "offline"
    ) {
      return reject("Worker organization availability is restricted");
    }
    if (profile.currentTaskCount >= profile.maxConcurrentTasks) {
      return reject("Worker is at maximum concurrent task capacity");
    }

    // Dependency readiness: reuse existing DependencyManager contract.
    // A dependent task must have all its dependencies in status "completed"
    // (not just "verification") before it may be delegated.
    if (!this.dependencyManager.canStart(task, tasks)) {
      return reject(
        "Task dependencies are not yet completed — delegation blocked"
      );
    }

    // Governed assignment: Runtime → DelegationService → SecurityGateway → Policy
    const result = this.runtime.assignSubtask(task, manager, worker, riskScore);

    if (result.delegation.decision !== "ALLOW" || !result.delegation.task) {
      return reject(result.delegation.reason);
    }

    tasks.set(result.delegation.task.id, result.delegation.task);

    return {
      decision: "DELEGATED",
      task: result.delegation.task,
      worker,
      message: result.message,
      reason: result.delegation.reason,
    };
  }

  /**
   * Monitor a worker's status, tasks, and messages — scoped to this allocation.
   *
   * Requires:
   *  - ACTIVE allocation owned by managerId.
   *  - Worker managed by this manager (registry hierarchy).
   *  - Worker has at least one task authorized by this allocation.
   *  - Uses Runtime.getWorkerStatus/Tasks/ProgressUpdates/BlockerUpdates unchanged.
   */
  monitorWorker(
    allocationId: string,
    managerId: string,
    workerId: string,
    tasks: Map<string, Task>
  ): MonitorResult {
    const reject = (reason: string): MonitorResult => ({
      decision: "REJECTED",
      workerStatus: null,
      tasks: [],
      progressMessages: [],
      blockerMessages: [],
      reason,
    });

    const auth = this.resolveAuth(allocationId, managerId);
    if (!auth.ok) return reject(auth.reason);

    const worker = this.registry.get(workerId);
    if (!worker || worker.role !== "worker" || worker.managerId !== managerId) {
      return reject("Worker is not managed by this manager");
    }

    const allAuthorizedIds = new Set(
      this.getAuthorizedTaskIds(allocationId, managerId, tasks)
    );
    const hasAllocationTask = Array.from(tasks.values()).some(
      (t) => t.assignedTo === workerId && allAuthorizedIds.has(t.id)
    );

    if (!hasAllocationTask) {
      return reject("Worker has no tasks in this allocation");
    }

    return {
      decision: "OK",
      workerStatus: this.runtime.getWorkerStatus(managerId, workerId),
      tasks: this.runtime.getWorkerTasks(managerId, workerId, tasks),
      progressMessages: this.runtime.getWorkerProgressUpdates(
        managerId,
        workerId
      ),
      blockerMessages: this.runtime.getWorkerBlockerUpdates(
        managerId,
        workerId
      ),
      reason: "Worker monitoring within allocation scope",
    };
  }

  /**
   * Handle a worker blocker on an allocation-authorized task.
   *
   * Routes through existing RecoveryService.  If recovery is exhausted,
   * auto-escalates to the manager's Boss via existing EscalationService.
   * No new recovery or escalation logic is introduced here.
   */
  handleBlocker(
    allocationId: string,
    managerId: string,
    task: Task,
    reason: string,
    tasks: Map<string, Task>,
    riskScore = 0
  ): BlockerResult {
    const auth = this.resolveAuth(allocationId, managerId);
    if (!auth.ok) {
      return {
        decision: "REJECTED",
        recovery: null,
        escalation: null,
        reason: auth.reason,
      };
    }
    const { manager } = auth;

    if (!this.isAuthorized(allocationId, managerId, task.id, tasks)) {
      return {
        decision: "REJECTED",
        recovery: null,
        escalation: null,
        reason: "Task is not authorized by this allocation",
      };
    }

    const recoveryResult = this.recovery.recover(
      task,
      managerId,
      reason,
      riskScore
    );

    if (recoveryResult.decision === "RECOVERED") {
      return {
        decision: "RECOVERED",
        recovery: recoveryResult,
        escalation: null,
        reason: recoveryResult.reason,
      };
    }

    if (recoveryResult.decision === "FAILED") {
      const bossId = manager.managerId;
      if (!bossId) {
        return {
          decision: "FAILED",
          recovery: recoveryResult,
          escalation: null,
          reason: "Recovery failed and manager has no boss to escalate to",
        };
      }

      const escalationResult = this.escalation.escalate({
        id: `escalation-blocker-${allocationId}-${task.id}-${this.nextId()}`,
        managerId,
        bossId,
        taskId: task.id,
        reason: `Recovery exhausted: ${reason}`,
      });

      return {
        decision:
          escalationResult.decision === "PENDING" ? "ESCALATED" : "FAILED",
        recovery: recoveryResult,
        escalation: escalationResult,
        reason: escalationResult.reason,
      };
    }

    // DENY from recovery (invalid input, missing worker, etc.)
    return {
      decision: "REJECTED",
      recovery: recoveryResult,
      escalation: null,
      reason: recoveryResult.reason,
    };
  }

  /**
   * Explicitly escalate an allocation-authorized task to the manager's Boss.
   *
   * Boss is derived from manager.managerId in the existing agent registry
   * hierarchy — no new lookup logic.
   */
  escalateTowardsBoss(
    allocationId: string,
    managerId: string,
    taskId: string,
    reason: string
  ): EscalationResult {
    const deny = (reason: string): EscalationResult => ({
      decision: "DENY",
      escalation: null,
      approval: null,
      message: null,
      reason,
    });

    const auth = this.resolveAuth(allocationId, managerId);
    if (!auth.ok) return deny(auth.reason);
    const { allocation, manager } = auth;

    const authorized =
      allocation.taskIds.includes(taskId) ||
      (this.derivedSubtasks.get(allocationId)?.has(taskId) ?? false);

    if (!authorized) {
      return deny("Task is not authorized by this allocation");
    }

    const bossId = manager.managerId;
    if (!bossId) return deny("Manager has no boss in the hierarchy");

    return this.escalation.escalate({
      id: `escalation-${allocationId}-${taskId}-${this.nextId()}`,
      managerId,
      bossId,
      taskId,
      reason,
    });
  }

  // ── Query helpers ───────────────────────────────────────────────────────────

  /**
   * Returns all task IDs currently authorized for this manager's active
   * allocation: original allocation.taskIds + coordinator-derived subtask IDs.
   */
  getAuthorizedTaskIds(
    allocationId: string,
    managerId: string,
    tasks: Map<string, Task>
  ): string[] {
    const allocation = this.allocationService.get(allocationId);
    if (
      !allocation ||
      allocation.status !== "ACTIVE" ||
      allocation.managerId !== managerId
    ) {
      return [];
    }
    const fromAllocation = this.allocationService
      .getAuthorizedTasks(allocationId, managerId, tasks)
      .map((t) => t.id);
    const derived = Array.from(
      this.derivedSubtasks.get(allocationId) ?? []
    );
    return [...fromAllocation, ...derived];
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private resolveAuth(allocationId: string, managerId: string): AuthResult {
    const allocation = this.allocationService.get(allocationId);
    if (!allocation) return { ok: false, reason: "Allocation not found" };
    if (allocation.status !== "ACTIVE") {
      return {
        ok: false,
        reason: "Only an ACTIVE allocation grants manager task authority",
      };
    }
    if (allocation.managerId !== managerId) {
      return { ok: false, reason: "Manager does not own this allocation" };
    }
    const manager = this.registry.get(managerId);
    if (!manager || manager.role !== "manager") {
      return { ok: false, reason: "Manager is not registered" };
    }
    return { ok: true, allocation, manager };
  }

  private isAuthorized(
    allocationId: string,
    managerId: string,
    taskId: string,
    tasks: Map<string, Task>
  ): boolean {
    const fromAllocation = this.allocationService
      .getAuthorizedTasks(allocationId, managerId, tasks)
      .some((t) => t.id === taskId);
    if (fromAllocation) return true;
    return this.derivedSubtasks.get(allocationId)?.has(taskId) ?? false;
  }

  private trackDerived(allocationId: string, taskIds: string[]): void {
    if (!this.derivedSubtasks.has(allocationId)) {
      this.derivedSubtasks.set(allocationId, new Set());
    }
    const set = this.derivedSubtasks.get(allocationId)!;
    for (const id of taskIds) set.add(id);
  }

  private nextId(): string {
    return String(++this.counter);
  }
}
