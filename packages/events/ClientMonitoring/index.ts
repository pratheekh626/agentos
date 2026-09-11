import type { LiveEventStream, StreamEvent } from "../LiveEventStream";

export interface ClientAuthContext {
  clientId: string;
  authorizedProjectIds: string[];
}

export interface ClientAuthorizationPolicy {
  isAuthorized(auth: ClientAuthContext, projectId: string): boolean;
}

export class DefaultClientAuthorizationPolicy implements ClientAuthorizationPolicy {
  isAuthorized(auth: ClientAuthContext, projectId: string): boolean {
    if (!auth || !auth.clientId || !projectId || !projectId.trim()) {
      return false;
    }
    return auth.authorizedProjectIds.includes(projectId);
  }
}

export interface ClientSafeEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  projectId: string;
  taskId: string | null;
  agentDisplayName: string | null;
  summary: string;
  payload: Record<string, unknown>;
}

export interface ClientProjectSummary {
  projectId: string;
  totalEvents: number;
  tasksCreated: number;
  tasksCompleted: number;
  verificationsPassed: number;
  qaPassed: number;
  paymentsReleased: number;
  totalPaidAmount: number;
  latestStatus: string | null;
  lastUpdated: string | null;
}

export interface ClientMonitoringOptions {
  authorizationPolicy?: ClientAuthorizationPolicy;
}

export class ClientMonitoringService {
  private readonly policy: ClientAuthorizationPolicy;
  private readonly taskToProject = new Map<string, string>();
  private readonly projectToTasks = new Map<string, Set<string>>();

  constructor(
    private readonly stream: LiveEventStream,
    options: ClientMonitoringOptions = {}
  ) {
    this.policy = options.authorizationPolicy ?? new DefaultClientAuthorizationPolicy();
  }

  registerProjectTask(projectId: string, taskId: string): void {
    if (!projectId || !taskId) return;
    this.taskToProject.set(taskId, projectId);
    let set = this.projectToTasks.get(projectId);
    if (!set) {
      set = new Set();
      this.projectToTasks.set(projectId, set);
    }
    set.add(taskId);
  }

  registerProjectTasks(projectId: string, taskIds: string[]): void {
    for (const taskId of taskIds) {
      this.registerProjectTask(projectId, taskId);
    }
  }

  getProjectForTask(taskId: string): string | null {
    return this.taskToProject.get(taskId) ?? null;
  }

  private isEventClientSafe(event: StreamEvent): boolean {
    if (event.visibility !== "public") {
      return false;
    }

    const internalTypes = new Set([
      "A2A_MESSAGE",
      "RECOVERY_ATTEMPTED",
      "RECOVERY_RESOLVED",
      "RECOVERY_FAILED",
      "ESCALATION_CREATED",
      "ESCALATION_APPROVED",
      "ESCALATION_REJECTED",
      "INTERVENTION_CREATED",
      "MANAGER_ALLOCATION_CREATED",
      "MANAGER_ALLOCATION_APPROVED",
      "MANAGER_ALLOCATION_ACTIVATED",
      "MANAGER_ALLOCATION_REJECTED",
      "MEETING_CREATED",
      "MEETING_STARTED",
      "MEETING_COMPLETED",
      "MEETING_DECISION_CREATED",
      "PAYMENT_ESCALATED",
    ]);

    if (internalTypes.has(event.eventType)) {
      return false;
    }

    return true;
  }

  private resolveProjectId(event: StreamEvent): string | null {
    if (event.projectId) {
      return event.projectId;
    }
    if (event.taskId) {
      return this.taskToProject.get(event.taskId) ?? null;
    }
    return null;
  }

  private sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const forbiddenKeys = new Set([
      "riskScore",
      "identityFingerprint",
      "walletBalance",
      "gatewayDecision",
      "anomalyScore",
      "delegationFirewallReason",
      "managerAllocationId",
      "rawAgentId",
      "securityToken",
      "internalReason",
      "signature",
    ]);

    for (const [key, value] of Object.entries(payload)) {
      if (!forbiddenKeys.has(key)) {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private formatAgentDisplayName(agentId: string | null, actorId: string | null): string | null {
    const id = agentId ?? actorId;
    if (!id) return null;

    if (id.startsWith("boss")) return "Boss Agent";
    if (id.startsWith("manager")) return `Manager (${id})`;
    if (id.startsWith("worker")) return `Worker (${id})`;
    return id;
  }

  private generateSummary(event: StreamEvent, safeAgentName: string | null): string {
    const agentText = safeAgentName ? ` by ${safeAgentName}` : "";
    const taskText = event.taskId ? ` for task ${event.taskId}` : "";

    switch (event.eventType) {
      case "TASK_CREATED":
        return `Task '${event.payload.title ?? event.taskId}' was created${agentText}.`;
      case "TASK_SCHEDULED":
        return `Task '${event.taskId}' was scheduled for execution.`;
      case "TASK_STARTED":
        return `Task '${event.taskId}' started execution${agentText}.`;
      case "TASK_COMPLETED":
        return `Task '${event.taskId}' was completed successfully${agentText}.`;
      case "EXECUTION_STARTED":
        return `Task execution started${agentText}${taskText}.`;
      case "EVIDENCE_SUBMITTED":
        return `Evidence '${event.payload.title ?? event.payload.evidenceId}' was submitted${agentText}${taskText}.`;
      case "EXECUTION_COMPLETED":
        return `Task execution completed${agentText}${taskText}.`;
      case "EXECUTION_FAILED":
        return `Task execution failed${agentText}${taskText}.`;
      case "VERIFICATION_PASSED":
        return `Verification passed for task ${event.taskId}.`;
      case "VERIFICATION_FAILED":
        return `Verification failed for task ${event.taskId}.`;
      case "QA_PASSED":
        return `QA check passed for task ${event.taskId} (score: ${event.payload.score ?? "N/A"}).`;
      case "QA_FAILED":
        return `QA check failed for task ${event.taskId}.`;
      case "PAYMENT_RELEASED":
        return `Payment of $${event.payload.amount ?? 0} released for task ${event.taskId}.`;
      default:
        return `Event ${event.eventType}${taskText}${agentText}.`;
    }
  }

  private toClientSafeEvent(event: StreamEvent): ClientSafeEvent | null {
    if (!this.isEventClientSafe(event)) {
      return null;
    }

    const projectId = this.resolveProjectId(event);
    if (!projectId) {
      return null;
    }

    const safeAgentName = this.formatAgentDisplayName(event.agentId, event.actorId);
    const summary = this.generateSummary(event, safeAgentName);

    return {
      eventId: event.eventId,
      eventType: event.eventType,
      timestamp: event.timestamp,
      projectId,
      taskId: event.taskId,
      agentDisplayName: safeAgentName,
      summary,
      payload: this.sanitizePayload(event.payload),
    };
  }

  getProjectActivity(
    auth: ClientAuthContext,
    projectId: string,
    limit?: number
  ): ClientSafeEvent[] {
    if (!this.policy.isAuthorized(auth, projectId)) {
      return [];
    }

    const allEvents = this.stream.getRecent();
    const result: ClientSafeEvent[] = [];

    for (const event of allEvents) {
      const resolvedProject = this.resolveProjectId(event);
      if (resolvedProject === projectId) {
        const safeEvent = this.toClientSafeEvent(event);
        if (safeEvent) {
          result.push(safeEvent);
        }
      }
    }

    return limit !== undefined ? result.slice(-limit) : result;
  }

  getTaskActivity(
    auth: ClientAuthContext,
    projectId: string,
    taskId: string,
    limit?: number
  ): ClientSafeEvent[] {
    if (!this.policy.isAuthorized(auth, projectId)) {
      return [];
    }

    const projectEvents = this.getProjectActivity(auth, projectId);
    const taskEvents = projectEvents.filter((e) => e.taskId === taskId);
    return limit !== undefined ? taskEvents.slice(-limit) : taskEvents;
  }

  getProjectSummary(
    auth: ClientAuthContext,
    projectId: string
  ): ClientProjectSummary | null {
    if (!this.policy.isAuthorized(auth, projectId)) {
      return null;
    }

    const events = this.getProjectActivity(auth, projectId);

    let tasksCreated = 0;
    let tasksCompleted = 0;
    let verificationsPassed = 0;
    let qaPassed = 0;
    let paymentsReleased = 0;
    let totalPaidAmount = 0;
    let latestStatus: string | null = null;
    let lastUpdated: string | null = null;

    for (const e of events) {
      lastUpdated = e.timestamp;
      latestStatus = e.eventType;

      if (e.eventType === "TASK_CREATED") tasksCreated++;
      if (e.eventType === "TASK_COMPLETED") tasksCompleted++;
      if (e.eventType === "VERIFICATION_PASSED") verificationsPassed++;
      if (e.eventType === "QA_PASSED") qaPassed++;
      if (e.eventType === "PAYMENT_RELEASED") {
        paymentsReleased++;
        if (typeof e.payload.amount === "number") {
          totalPaidAmount += e.payload.amount;
        }
      }
    }

    return {
      projectId,
      totalEvents: events.length,
      tasksCreated,
      tasksCompleted,
      verificationsPassed,
      qaPassed,
      paymentsReleased,
      totalPaidAmount,
      latestStatus,
      lastUpdated,
    };
  }

  subscribeToProject(
    auth: ClientAuthContext,
    projectId: string,
    listener: (event: ClientSafeEvent) => void
  ): () => void {
    if (!this.policy.isAuthorized(auth, projectId)) {
      return () => {};
    }

    return this.stream.subscribe((rawEvent: StreamEvent) => {
      const resolvedProject = this.resolveProjectId(rawEvent);
      if (resolvedProject === projectId) {
        const safeEvent = this.toClientSafeEvent(rawEvent);
        if (safeEvent) {
          listener(safeEvent);
        }
      }
    });
  }
}
