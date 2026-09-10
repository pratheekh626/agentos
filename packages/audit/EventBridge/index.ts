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
import type {
  PaymentEvent,
  ProofToPayEvents,
} from "../../verification/ProofToPay";

export class AuditEventBridge {
  private readonly ledger: AuditLedger;
  private readonly eventBus: EventBus<ExecutionEvents>;
  private readonly verificationEventBus: EventBus<VerificationEvents>;
  private readonly qaEventBus: EventBus<QAEvents>;
  private readonly paymentEventBus: EventBus<ProofToPayEvents>;

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

  private readonly handlePaymentReleased = (
    event: PaymentEvent
  ): void => {
    const transaction = event.result.creditResult?.transaction;

    this.ledger.append({
      id: `audit-payment-released-${event.request.id}`,
      type: "PAYMENT_RELEASED",
      actorId: event.request.agent.id,
      action: "payment_released",
      targetId: transaction?.id ?? event.request.id,
      taskId: event.request.taskId,
      details: {
        amount: event.request.amount,
        reason: event.request.reason,
        transactionId: transaction?.id ?? null,
        transactionStatus: transaction?.status ?? null,
        creditReason: event.result.reason,
      },
      timestamp:
        transaction?.completedAt ??
        transaction?.createdAt ??
        new Date().toISOString(),
    });
  };

  private readonly handlePaymentEscalated = (
    event: PaymentEvent
  ): void => {
    const transaction = event.result.creditResult?.transaction;

    this.ledger.append({
      id: `audit-payment-escalated-${event.request.id}`,
      type: "PAYMENT_ESCALATED",
      actorId: event.request.agent.id,
      action: "payment_escalated",
      targetId: transaction?.id ?? event.request.id,
      taskId: event.request.taskId,
      details: {
        amount: event.request.amount,
        reason: event.request.reason,
        transactionId: transaction?.id ?? null,
        transactionStatus: transaction?.status ?? null,
        creditReason: event.result.reason,
      },
      timestamp:
        transaction?.createdAt ??
        new Date().toISOString(),
    });
  };

  constructor(
    ledger: AuditLedger,
    eventBus: EventBus<ExecutionEvents>,
    verificationEventBus?: EventBus<VerificationEvents>,
    qaEventBus?: EventBus<QAEvents>,
    paymentEventBus?: EventBus<ProofToPayEvents>
  ) {
    this.ledger = ledger;
    this.eventBus = eventBus;
    this.verificationEventBus =
      verificationEventBus ?? new EventBus<VerificationEvents>();
    this.qaEventBus =
      qaEventBus ?? new EventBus<QAEvents>();
    this.paymentEventBus =
      paymentEventBus ?? new EventBus<ProofToPayEvents>();

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

    this.paymentEventBus.on(
      "payment.released",
      this.handlePaymentReleased
    );

    this.paymentEventBus.on(
      "payment.escalated",
      this.handlePaymentEscalated
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

    this.paymentEventBus.off(
      "payment.released",
      this.handlePaymentReleased
    );

    this.paymentEventBus.off(
      "payment.escalated",
      this.handlePaymentEscalated
    );
  }
}