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
import type {
  RecoveryEvents,
  RecoveryRecord,
} from "../../orchestration/Recovery";
import type {
  EscalationEvents,
  EscalationRecord,
} from "../../orchestration/Escalation";
import type {
  InterventionEvents,
  InterventionRecord,
} from "../../orchestration/Intervention";
import type {
  ConferenceEvents,
  Meeting,
  MeetingDecision,
} from "../../agents/ConferenceRoom";
import type { AllocationEvents, ManagerAllocation } from "../../orchestration/ManagerAllocation";

export class AuditEventBridge {
  private readonly ledger: AuditLedger;
  private readonly eventBus: EventBus<ExecutionEvents>;
  private readonly verificationEventBus: EventBus<VerificationEvents>;
  private readonly qaEventBus: EventBus<QAEvents>;
  private readonly paymentEventBus: EventBus<ProofToPayEvents>;
  private readonly recoveryEventBus: EventBus<RecoveryEvents>;
  private readonly escalationEventBus: EventBus<EscalationEvents>;
  private readonly interventionEventBus: EventBus<InterventionEvents>;
  private readonly conferenceEventBus: EventBus<ConferenceEvents>;
  private readonly allocationEventBus: EventBus<AllocationEvents>;

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

  private readonly handleRecoveryAttempted = (
    recovery: RecoveryRecord
  ): void => {
    this.appendRecoveryEvent(
      recovery,
      "RECOVERY_ATTEMPTED",
      "recovery_attempted"
    );
  };

  private readonly handleRecoverySucceeded = (
    recovery: RecoveryRecord
  ): void => {
    this.appendRecoveryEvent(
      recovery,
      "RECOVERY_SUCCEEDED",
      "recovery_succeeded"
    );
  };

  private readonly handleRecoveryFailed = (
    recovery: RecoveryRecord
  ): void => {
    this.appendRecoveryEvent(
      recovery,
      "RECOVERY_FAILED",
      "recovery_failed"
    );
  };

  private readonly handleEscalationCreated = (
    escalation: EscalationRecord
  ): void => {
    this.appendEscalationEvent(
      escalation,
      "ESCALATION_CREATED",
      "escalation_created",
      escalation.managerId
    );
  };

  private readonly handleEscalationApproved = (
    escalation: EscalationRecord
  ): void => {
    this.appendEscalationEvent(
      escalation,
      "ESCALATION_APPROVED",
      "escalation_approved",
      escalation.bossId
    );
  };

  private readonly handleEscalationRejected = (
    escalation: EscalationRecord
  ): void => {
    this.appendEscalationEvent(
      escalation,
      "ESCALATION_REJECTED",
      "escalation_rejected",
      escalation.bossId
    );
  };

  private readonly handleInterventionCreated = (
    intervention: InterventionRecord
  ): void => {
    this.ledger.append({
      id: `audit-intervention-${intervention.id}`,
      type: "INTERVENTION_CREATED",
      actorId: intervention.bossId,
      targetId: intervention.managerId,
      taskId: intervention.taskId,
      action: "intervention_created",
      details: {
        escalationId: intervention.escalationId,
        action: intervention.action,
        instruction: intervention.instruction,
      },
      timestamp: intervention.createdAt,
    });
  };

  private readonly handleMeetingCreated = (
    meeting: Meeting
  ): void => {
    this.ledger.append({
      id: `audit-meeting-created-${meeting.id}`,
      type: "MEETING_CREATED",
      actorId: meeting.calledBy,
      targetId: meeting.id,
      taskId: meeting.taskId,
      action: "meeting_created",
      details: {
        projectId: meeting.projectId,
        participants: meeting.participants,
        agenda: meeting.agenda,
      },
      timestamp: meeting.createdAt,
    });
  };

  private readonly handleMeetingDecision = (
    decision: MeetingDecision
  ): void => {
    this.ledger.append({
      id: `audit-meeting-decision-${decision.id}`,
      type: "MEETING_DECISION_CREATED",
      actorId: decision.decidedBy,
      targetId: decision.meetingId,
      taskId: null,
      action: "meeting_decision_created",
      details: {
        decisionType: decision.decisionType,
        summary: decision.summary,
        taskIds: decision.taskIds,
        managerId: decision.managerId,
      },
      timestamp: decision.createdAt,
    });
  };

  private readonly handleMeetingCompleted = (
    meeting: Meeting
  ): void => {
    this.ledger.append({
      id: `audit-meeting-completed-${meeting.id}`,
      type: "MEETING_COMPLETED",
      actorId: meeting.calledBy,
      targetId: meeting.id,
      taskId: meeting.taskId,
      action: "meeting_completed",
      details: {
        projectId: meeting.projectId,
        participants: meeting.participants,
      },
      timestamp: meeting.completedAt ?? meeting.createdAt,
    });
  };

  private readonly handleAllocation = (allocation: ManagerAllocation): void => {
    const statusType = {
      PROPOSED: "MANAGER_ALLOCATION_CREATED",
      APPROVED: "MANAGER_ALLOCATION_APPROVED",
      ACTIVE: "MANAGER_ALLOCATION_ACTIVATED",
      REJECTED: "MANAGER_ALLOCATION_REJECTED",
      COMPLETED: "MANAGER_ALLOCATION_ACTIVATED",
    } as const;
    this.ledger.append({
      id: `audit-allocation-${allocation.id}-${allocation.status}`,
      type: statusType[allocation.status],
      actorId: allocation.assignedBy,
      targetId: allocation.managerId,
      taskId: allocation.taskIds[0] ?? null,
      action: `manager_allocation_${allocation.status.toLowerCase()}`,
      details: { organizationId: allocation.organizationId, meetingId: allocation.meetingId, decisionId: allocation.decisionId, taskIds: allocation.taskIds },
      timestamp: allocation.createdAt,
    });
  };

  constructor(
    ledger: AuditLedger,
    eventBus: EventBus<ExecutionEvents>,
    verificationEventBus?: EventBus<VerificationEvents>,
    qaEventBus?: EventBus<QAEvents>,
    paymentEventBus?: EventBus<ProofToPayEvents>,
    recoveryEventBus?: EventBus<RecoveryEvents>,
    escalationEventBus?: EventBus<EscalationEvents>,
    interventionEventBus?: EventBus<InterventionEvents>,
    conferenceEventBus?: EventBus<ConferenceEvents>,
    allocationEventBus?: EventBus<AllocationEvents>
  ) {
    this.ledger = ledger;
    this.eventBus = eventBus;
    this.verificationEventBus =
      verificationEventBus ?? new EventBus<VerificationEvents>();
    this.qaEventBus =
      qaEventBus ?? new EventBus<QAEvents>();
    this.paymentEventBus =
      paymentEventBus ?? new EventBus<ProofToPayEvents>();
    this.recoveryEventBus =
      recoveryEventBus ?? new EventBus<RecoveryEvents>();
    this.escalationEventBus =
      escalationEventBus ?? new EventBus<EscalationEvents>();
    this.interventionEventBus =
      interventionEventBus ?? new EventBus<InterventionEvents>();
    this.conferenceEventBus =
      conferenceEventBus ?? new EventBus<ConferenceEvents>();
    this.allocationEventBus = allocationEventBus ?? new EventBus<AllocationEvents>();

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

    this.recoveryEventBus.on(
      "recovery.attempted",
      this.handleRecoveryAttempted
    );
    this.recoveryEventBus.on(
      "recovery.succeeded",
      this.handleRecoverySucceeded
    );
    this.recoveryEventBus.on(
      "recovery.failed",
      this.handleRecoveryFailed
    );

    this.escalationEventBus.on(
      "escalation.created",
      this.handleEscalationCreated
    );
    this.escalationEventBus.on(
      "escalation.approved",
      this.handleEscalationApproved
    );
    this.escalationEventBus.on(
      "escalation.rejected",
      this.handleEscalationRejected
    );

    this.interventionEventBus.on(
      "intervention.created",
      this.handleInterventionCreated
    );

    this.conferenceEventBus.on(
      "meeting.created",
      this.handleMeetingCreated
    );
    this.conferenceEventBus.on(
      "meeting.decision_created",
      this.handleMeetingDecision
    );
    this.conferenceEventBus.on(
      "meeting.completed",
      this.handleMeetingCompleted
    );
    this.allocationEventBus.on("allocation.created", this.handleAllocation);
    this.allocationEventBus.on("allocation.approved", this.handleAllocation);
    this.allocationEventBus.on("allocation.activated", this.handleAllocation);
    this.allocationEventBus.on("allocation.rejected", this.handleAllocation);
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

    this.recoveryEventBus.off(
      "recovery.attempted",
      this.handleRecoveryAttempted
    );
    this.recoveryEventBus.off(
      "recovery.succeeded",
      this.handleRecoverySucceeded
    );
    this.recoveryEventBus.off(
      "recovery.failed",
      this.handleRecoveryFailed
    );

    this.escalationEventBus.off(
      "escalation.created",
      this.handleEscalationCreated
    );
    this.escalationEventBus.off(
      "escalation.approved",
      this.handleEscalationApproved
    );
    this.escalationEventBus.off(
      "escalation.rejected",
      this.handleEscalationRejected
    );

    this.interventionEventBus.off(
      "intervention.created",
      this.handleInterventionCreated
    );

    this.conferenceEventBus.off(
      "meeting.created",
      this.handleMeetingCreated
    );
    this.conferenceEventBus.off(
      "meeting.decision_created",
      this.handleMeetingDecision
    );
    this.conferenceEventBus.off(
      "meeting.completed",
      this.handleMeetingCompleted
    );
    this.allocationEventBus.off("allocation.created", this.handleAllocation);
    this.allocationEventBus.off("allocation.approved", this.handleAllocation);
    this.allocationEventBus.off("allocation.activated", this.handleAllocation);
    this.allocationEventBus.off("allocation.rejected", this.handleAllocation);
  }

  private appendRecoveryEvent(
    recovery: RecoveryRecord,
    type:
      | "RECOVERY_ATTEMPTED"
      | "RECOVERY_SUCCEEDED"
      | "RECOVERY_FAILED",
    action: string
  ): void {
    this.ledger.append({
      id: `audit-${action}-${recovery.id}`,
      type,
      actorId: recovery.failedAgentId,
      targetId: recovery.failedAgentId,
      taskId: recovery.taskId,
      action,
      details: {
        reason: recovery.reason,
        attempt: recovery.attempt,
        recoveryAction: recovery.action,
        status: recovery.status,
      },
      timestamp: recovery.createdAt,
    });
  }

  private appendEscalationEvent(
    escalation: EscalationRecord,
    type:
      | "ESCALATION_CREATED"
      | "ESCALATION_APPROVED"
      | "ESCALATION_REJECTED",
    action: string,
    actorId: string
  ): void {
    this.ledger.append({
      id: `audit-${action}-${escalation.id}`,
      type,
      actorId,
      targetId: escalation.managerId,
      taskId: escalation.taskId,
      action,
      details: {
        bossId: escalation.bossId,
        reason: escalation.reason,
        approvalRequestId: escalation.approvalRequestId,
      },
      timestamp: escalation.createdAt,
    });
  }
}