import { AuditLedger } from "../AuditLedger";
import { EventBus } from "../../messaging/EventBus";
import { ExecutionEvents } from "../../agents/Execution";
import { Evidence } from "../../verification/Evidence";

export class AuditEventBridge {
  private readonly ledger: AuditLedger;
  private readonly eventBus: EventBus<ExecutionEvents>;

  private readonly evidenceHandler = (evidence: Evidence): void => {
    this.ledger.append({
      id: `audit-${evidence.id}`,
      type: "EVIDENCE_SUBMITTED",
      actorId: evidence.agentId,
      action: "evidence_submitted",
      targetId: evidence.id,
      taskId: evidence.taskId,
      details: {
        evidenceType: evidence.type,
        title: evidence.title,
        description: evidence.description,
        reference: evidence.reference,
      },
      timestamp: evidence.createdAt,
    });
  };

  constructor(
    ledger: AuditLedger,
    eventBus: EventBus<ExecutionEvents>
  ) {
    this.ledger = ledger;
    this.eventBus = eventBus;

    this.eventBus.on(
      "execution.evidence_created",
      this.evidenceHandler
    );
  }

  disconnect(): void {
    this.eventBus.off(
      "execution.evidence_created",
      this.evidenceHandler
    );
  }
}