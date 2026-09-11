import { createHash } from "node:crypto";

export type AuditEventType =
  | "AGENT_REGISTERED"
  | "TASK_CREATED"
  | "TASK_ASSIGNED"
  | "TASK_DELEGATED"
  | "DELEGATION_ESCALATED"
  | "CREDIT_REQUESTED"
  | "CREDIT_APPROVED"
  | "CREDIT_REJECTED"
  | "EVIDENCE_SUBMITTED"
  | "VERIFICATION_PASSED"
  | "VERIFICATION_FAILED"
  | "QA_PASSED"
  | "QA_FAILED"
  | "PAYMENT_RELEASED"
  | "PAYMENT_ESCALATED"
  | "RECOVERY_ATTEMPTED"
  | "RECOVERY_SUCCEEDED"
  | "RECOVERY_FAILED"
  | "ESCALATION_CREATED"
  | "ESCALATION_APPROVED"
  | "ESCALATION_REJECTED"
  | "INTERVENTION_CREATED"
  | "MEETING_CREATED"
  | "MEETING_DECISION_CREATED"
  | "MEETING_COMPLETED"
  | "MANAGER_ALLOCATION_CREATED"
  | "MANAGER_ALLOCATION_APPROVED"
  | "MANAGER_ALLOCATION_ACTIVATED"
  | "MANAGER_ALLOCATION_REJECTED";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  actorId: string;
  targetId: string | null;
  taskId: string | null;
  action: string;
  details: Record<string, unknown>;
  timestamp: string;
  previousEventHash: string | null;
  eventHash: string;
}

export interface CreateAuditEventInput {
  id: string;
  type: AuditEventType;
  actorId: string;
  targetId?: string | null;
  taskId?: string | null;
  action: string;
  details?: Record<string, unknown>;
  timestamp?: string;
}

export class AuditLedger {
  private readonly events = new Map<string, AuditEvent>();

  append(input: CreateAuditEventInput): AuditEvent {
    if (this.events.has(input.id)) {
      throw new Error(`Audit event already exists: ${input.id}`);
    }

    if (!input.actorId.trim()) {
      throw new Error("Audit event actor is required");
    }

    if (!input.action.trim()) {
      throw new Error("Audit event action is required");
    }

    const previousEvent = this.getLastEvent();

    const eventWithoutHash = {
      id: input.id,
      type: input.type,
      actorId: input.actorId,
      targetId: input.targetId ?? null,
      taskId: input.taskId ?? null,
      action: input.action,
      details: input.details ?? {},
      timestamp: input.timestamp ?? new Date().toISOString(),
      previousEventHash: previousEvent?.eventHash ?? null,
    };

    const eventHash = this.calculateHash(eventWithoutHash);

    const event: AuditEvent = {
      ...eventWithoutHash,
      eventHash,
    };

    this.events.set(event.id, event);

    return this.clone(event);
  }

  get(id: string): AuditEvent | undefined {
    const event = this.events.get(id);
    return event ? this.clone(event) : undefined;
  }

  getAll(): AuditEvent[] {
    return Array.from(this.events.values()).map((event) =>
      this.clone(event)
    );
  }

  getByActor(actorId: string): AuditEvent[] {
    return this.getAll().filter((event) => event.actorId === actorId);
  }

  getByTask(taskId: string): AuditEvent[] {
    return this.getAll().filter((event) => event.taskId === taskId);
  }

  getByType(type: AuditEventType): AuditEvent[] {
    return this.getAll().filter((event) => event.type === type);
  }

  verifyIntegrity(): boolean {
    let previousHash: string | null = null;

    for (const event of this.events.values()) {
      if (event.previousEventHash !== previousHash) {
        return false;
      }

      const expectedHash = this.calculateHash({
        id: event.id,
        type: event.type,
        actorId: event.actorId,
        targetId: event.targetId,
        taskId: event.taskId,
        action: event.action,
        details: event.details,
        timestamp: event.timestamp,
        previousEventHash: event.previousEventHash,
      });

      if (event.eventHash !== expectedHash) {
        return false;
      }

      previousHash = event.eventHash;
    }

    return true;
  }

  count(): number {
    return this.events.size;
  }

  private getLastEvent(): AuditEvent | undefined {
    const events = Array.from(this.events.values());
    return events[events.length - 1];
  }

  private calculateHash(data: unknown): string {
    return createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
  }

  private clone(event: AuditEvent): AuditEvent {
    return {
      ...event,
      details: { ...event.details },
    };
  }
}
