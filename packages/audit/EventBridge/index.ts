import { AuditLedger } from "../AuditLedger";
import { EventBus } from "../../messaging/EventBus";
import type { ExecutionEvents } from "../../agents/Execution";
import type { Evidence } from "../../verification/Evidence";
import type {
  VerificationEvents,
  VerificationCheck,
} from "../../verification/Verification";

export class AuditEventBridge {
  private readonly ledger: AuditLedger;
  private readonly eventBus: EventBus<ExecutionEvents>;
  private readonly verificationEventBus: EventBus<VerificationEvents>;

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

  private readonly verificationPassedHandler = (
    check: VerificationCheck
  ): void => {
    this.ledger.append({
      id: `audit-verification-passed-${check.id}`,
      type: "VERIFICATION_PASSED",
      actorId: check.verifiedBy ?? "unknown",
      action: "verification_passed",
      targetId: check.id,
      taskId: check.taskId,
      details: {
        score: check.score,
        reason: check.reason,
        evidenceIds: check.evidenceIds,
      },
      timestamp: check.completedAt ?? check.createdAt,
    });
  };

  private readonly verificationFailedHandler = (
    check: VerificationCheck
  ): void => {
    this.ledger.append({
      id: `audit-verification-failed-${check.id}`,
      type: "VERIFICATION_FAILED",
      actorId: check.verifiedBy ?? "unknown",
      action: "verification_failed",
      targetId: check.id,
      taskId: check.taskId,
      details: {
        score: check.score,
        reason: check.reason,
        evidenceIds: check.evidenceIds,
      },
      timestamp: check.completedAt ?? check.createdAt,
    });
  };

  constructor(
    ledger: AuditLedger,
    eventBus: EventBus<ExecutionEvents>,
    verificationEventBus?: EventBus<VerificationEvents>
  ) {
    this.ledger = ledger;
    this.eventBus = eventBus;
    this.verificationEventBus =
      verificationEventBus ?? new EventBus<VerificationEvents>();

    this.eventBus.on(
      "execution.evidence_created",
      this.evidenceHandler
    );

    this.verificationEventBus.on(
      "verification.passed",
      this.verificationPassedHandler
    );

    this.verificationEventBus.on(
      "verification.failed",
      this.verificationFailedHandler
    );
  }

  disconnect(): void {
    this.eventBus.off(
      "execution.evidence_created",
      this.evidenceHandler
    );

    this.verificationEventBus.off(
      "verification.passed",
      this.verificationPassedHandler
    );

    this.verificationEventBus.off(
      "verification.failed",
      this.verificationFailedHandler
    );
  }
}