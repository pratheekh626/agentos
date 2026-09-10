import { AuditLedger } from "../AuditLedger";
import { EventBus } from "../../messaging/EventBus";
import type { ExecutionEvents } from "../../agents/Execution";
import type { Evidence } from "../../verification/Evidence";
import type {
  VerificationEvents,
  VerificationCheck,
} from "../../verification/Verification";
import type {
  QAEvents,
  QACheck,
} from "../../verification/QA";

export class AuditEventBridge {
  private readonly ledger: AuditLedger;
  private readonly eventBus: EventBus<ExecutionEvents>;
  private readonly verificationEventBus: EventBus<VerificationEvents>;
  private readonly qaEventBus: EventBus<QAEvents>;

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

  private readonly handleQAPassed = (
    check: QACheck
  ): void => {
    this.ledger.append({
      id: `audit-qa-passed-${check.id}`,
      type: "QA_PASSED",
      actorId: check.checkedBy ?? "unknown",
      action: "qa_passed",
      targetId: check.id,
      taskId: check.taskId,
      details: {
        score: check.score,
        checks: check.checks,
      },
      timestamp: check.completedAt ?? check.createdAt,
    });
  };

  private readonly handleQAFailed = (
    check: QACheck
  ): void => {
    this.ledger.append({
      id: `audit-qa-failed-${check.id}`,
      type: "QA_FAILED",
      actorId: check.checkedBy ?? "unknown",
      action: "qa_failed",
      targetId: check.id,
      taskId: check.taskId,
      details: {
        score: check.score,
        checks: check.checks,
        issues: check.issues,
      },
      timestamp: check.completedAt ?? check.createdAt,
    });
  };

  constructor(
    ledger: AuditLedger,
    eventBus: EventBus<ExecutionEvents>,
    verificationEventBus?: EventBus<VerificationEvents>,
    qaEventBus?: EventBus<QAEvents>
  ) {
    this.ledger = ledger;
    this.eventBus = eventBus;
    this.verificationEventBus =
      verificationEventBus ?? new EventBus<VerificationEvents>();
    this.qaEventBus =
      qaEventBus ?? new EventBus<QAEvents>();

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

    this.qaEventBus.on(
      "qa.passed",
      this.handleQAPassed
    );

    this.qaEventBus.on(
      "qa.failed",
      this.handleQAFailed
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

    this.qaEventBus.off(
      "qa.passed",
      this.handleQAPassed
    );

    this.qaEventBus.off(
      "qa.failed",
      this.handleQAFailed
    );
  }
}