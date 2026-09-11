import { EventBus } from "../../messaging/EventBus";
import { LiveEventStream } from "./index";

import type { AgentRuntimeEvents } from "../../agents/Runtime";
import type { ExecutionEvents } from "../../agents/Execution";
import type { Evidence } from "../../verification/Evidence";
import type {
  VerificationEvents,
  VerificationCheck,
} from "../../verification/Verification";
import type { QAEvents, QACheck } from "../../verification/QA";
import type {
  ProofToPayEvents,
  PaymentEvent,
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
  AllocationEvents,
  ManagerAllocation,
} from "../../orchestration/ManagerAllocation";
import type {
  ConferenceEvents,
  Meeting,
  MeetingDecision,
} from "../../agents/ConferenceRoom";
import type { Task } from "../../core/Task";
import type { A2AMessage } from "../../messaging/A2A";
import type { ScheduleResult } from "../../orchestration/Scheduler";

export class LiveEventBridge {
  private readonly handlers: Array<{
    bus: EventBus<any>;
    event: string;
    handler: (data: any) => void;
  }> = [];

  constructor(
    private readonly stream: LiveEventStream,
    buses: {
      runtimeEvents?: EventBus<AgentRuntimeEvents>;
      executionEvents?: EventBus<ExecutionEvents>;
      verificationEvents?: EventBus<VerificationEvents>;
      qaEvents?: EventBus<QAEvents>;
      paymentEvents?: EventBus<ProofToPayEvents>;
      recoveryEvents?: EventBus<RecoveryEvents>;
      escalationEvents?: EventBus<EscalationEvents>;
      interventionEvents?: EventBus<InterventionEvents>;
      allocationEvents?: EventBus<AllocationEvents>;
      conferenceEvents?: EventBus<ConferenceEvents>;
    } = {}
  ) {
    if (buses.runtimeEvents) this.attachRuntime(buses.runtimeEvents);
    if (buses.executionEvents) this.attachExecution(buses.executionEvents);
    if (buses.verificationEvents) this.attachVerification(buses.verificationEvents);
    if (buses.qaEvents) this.attachQA(buses.qaEvents);
    if (buses.paymentEvents) this.attachPayment(buses.paymentEvents);
    if (buses.recoveryEvents) this.attachRecovery(buses.recoveryEvents);
    if (buses.escalationEvents) this.attachEscalation(buses.escalationEvents);
    if (buses.interventionEvents) this.attachIntervention(buses.interventionEvents);
    if (buses.allocationEvents) this.attachAllocation(buses.allocationEvents);
    if (buses.conferenceEvents) this.attachConference(buses.conferenceEvents);
  }

  disconnect(): void {
    for (const { bus, event, handler } of this.handlers) {
      bus.off(event, handler);
    }
    this.handlers.length = 0;
  }

  private register<TBus extends EventBus<any>>(
    bus: TBus,
    event: string,
    handler: (data: any) => void
  ): void {
    bus.on(event, handler);
    this.handlers.push({ bus, event, handler });
  }

  private attachRuntime(bus: EventBus<AgentRuntimeEvents>): void {
    this.register(bus, "task.created", (task: Task) => {
      this.stream.publish({
        eventType: "TASK_CREATED",
        timestamp: task.createdAt,
        taskId: task.id,
        actorId: task.createdBy,
        payload: { title: task.title, priority: task.priority, budget: task.budget },
        visibility: "public",
      });
    });

    this.register(bus, "task.scheduled", (result: ScheduleResult) => {
      if (result.task) {
        this.stream.publish({
          eventType: "TASK_SCHEDULED",
          taskId: result.task.id,
          agentId: result.task.assignedTo,
          actorId: result.agent?.id ?? null,
          payload: { decision: result.decision, reason: result.reason },
          visibility: "public",
        });
      }
    });

    this.register(bus, "task.started", (task: Task) => {
      this.stream.publish({
        eventType: "TASK_STARTED",
        timestamp: task.updatedAt,
        taskId: task.id,
        agentId: task.assignedTo,
        payload: { status: task.status },
        visibility: "public",
      });
    });

    this.register(bus, "task.completed", (task: Task) => {
      this.stream.publish({
        eventType: "TASK_COMPLETED",
        timestamp: task.updatedAt,
        taskId: task.id,
        agentId: task.assignedTo,
        payload: { status: task.status },
        visibility: "public",
      });
    });

    this.register(bus, "agent.message_sent", (msg: A2AMessage) => {
      this.stream.publish({
        eventType: "A2A_MESSAGE",
        timestamp: msg.createdAt,
        taskId: msg.taskId,
        agentId: msg.toAgentId,
        actorId: msg.fromAgentId,
        payload: { messageType: msg.type, subject: msg.subject, content: msg.content },
        visibility: "internal",
      });
    });
  }

  private attachExecution(bus: EventBus<ExecutionEvents>): void {
    this.register(bus, "execution.started", (rec) => {
      this.stream.publish({
        eventType: "EXECUTION_STARTED",
        timestamp: rec.startedAt,
        taskId: rec.taskId,
        agentId: rec.agentId,
        payload: { status: rec.status },
        visibility: "public",
      });
    });

    this.register(bus, "execution.evidence_created", (evidence: Evidence) => {
      this.stream.publish({
        eventType: "EVIDENCE_SUBMITTED",
        timestamp: evidence.createdAt,
        taskId: evidence.taskId,
        agentId: evidence.agentId,
        actorId: evidence.agentId,
        payload: { evidenceId: evidence.id, type: evidence.type, title: evidence.title },
        visibility: "public",
      });
    });

    this.register(bus, "execution.completed", (rec) => {
      this.stream.publish({
        eventType: "EXECUTION_COMPLETED",
        timestamp: rec.completedAt ?? new Date().toISOString(),
        taskId: rec.taskId,
        agentId: rec.agentId,
        payload: { evidenceId: rec.evidenceId, output: rec.output },
        visibility: "public",
      });
    });

    this.register(bus, "execution.failed", (rec) => {
      this.stream.publish({
        eventType: "EXECUTION_FAILED",
        timestamp: rec.completedAt ?? new Date().toISOString(),
        taskId: rec.taskId,
        agentId: rec.agentId,
        payload: { output: rec.output },
        visibility: "public",
      });
    });
  }

  private attachVerification(bus: EventBus<VerificationEvents>): void {
    this.register(bus, "verification.passed", (check: VerificationCheck) => {
      this.stream.publish({
        eventType: "VERIFICATION_PASSED",
        timestamp: check.completedAt ?? check.createdAt,
        taskId: check.taskId,
        actorId: check.verifiedBy,
        payload: { verificationId: check.id, score: check.score, reason: check.reason },
        visibility: "public",
      });
    });

    this.register(bus, "verification.failed", (check: VerificationCheck) => {
      this.stream.publish({
        eventType: "VERIFICATION_FAILED",
        timestamp: check.completedAt ?? check.createdAt,
        taskId: check.taskId,
        actorId: check.verifiedBy,
        payload: { verificationId: check.id, score: check.score, reason: check.reason },
        visibility: "public",
      });
    });
  }

  private attachQA(bus: EventBus<QAEvents>): void {
    this.register(bus, "qa.passed", (check: QACheck) => {
      this.stream.publish({
        eventType: "QA_PASSED",
        timestamp: check.completedAt ?? check.createdAt,
        taskId: check.taskId,
        actorId: check.checkedBy,
        payload: { qaId: check.id, score: check.score },
        visibility: "public",
      });
    });

    this.register(bus, "qa.failed", (check: QACheck) => {
      this.stream.publish({
        eventType: "QA_FAILED",
        timestamp: check.completedAt ?? check.createdAt,
        taskId: check.taskId,
        actorId: check.checkedBy,
        payload: { qaId: check.id, score: check.score, issues: check.issues },
        visibility: "public",
      });
    });
  }

  private attachPayment(bus: EventBus<ProofToPayEvents>): void {
    this.register(bus, "payment.released", (event: PaymentEvent) => {
      this.stream.publish({
        eventType: "PAYMENT_RELEASED",
        taskId: event.request.taskId,
        agentId: event.request.agent.id,
        actorId: event.request.agent.id,
        payload: { amount: event.request.amount, reason: event.result.reason },
        visibility: "public",
      });
    });

    this.register(bus, "payment.escalated", (event: PaymentEvent) => {
      this.stream.publish({
        eventType: "PAYMENT_ESCALATED",
        taskId: event.request.taskId,
        agentId: event.request.agent.id,
        actorId: event.request.agent.id,
        payload: { amount: event.request.amount, reason: event.result.reason },
        visibility: "internal",
      });
    });
  }

  private attachRecovery(bus: EventBus<RecoveryEvents>): void {
    this.register(bus, "recovery.attempted", (rec: RecoveryRecord) => {
      this.stream.publish({
        eventType: "RECOVERY_ATTEMPTED",
        timestamp: rec.createdAt,
        taskId: rec.taskId,
        actorId: rec.failedAgentId,
        payload: { recoveryId: rec.id, action: rec.action, attempt: rec.attempt },
        visibility: "internal",
      });
    });

    this.register(bus, "recovery.succeeded", (rec: RecoveryRecord) => {
      this.stream.publish({
        eventType: "RECOVERY_RESOLVED",
        timestamp: rec.createdAt,
        taskId: rec.taskId,
        actorId: rec.failedAgentId,
        payload: { recoveryId: rec.id, action: rec.action },
        visibility: "internal",
      });
    });

    this.register(bus, "recovery.failed", (rec: RecoveryRecord) => {
      this.stream.publish({
        eventType: "RECOVERY_FAILED",
        timestamp: rec.createdAt,
        taskId: rec.taskId,
        actorId: rec.failedAgentId,
        payload: { recoveryId: rec.id, action: rec.action, reason: rec.reason },
        visibility: "internal",
      });
    });
  }

  private attachEscalation(bus: EventBus<EscalationEvents>): void {
    this.register(bus, "escalation.created", (rec: EscalationRecord) => {
      this.stream.publish({
        eventType: "ESCALATION_CREATED",
        timestamp: rec.createdAt,
        taskId: rec.taskId,
        actorId: rec.managerId,
        payload: { escalationId: rec.id, bossId: rec.bossId, reason: rec.reason },
        visibility: "internal",
      });
    });

    this.register(bus, "escalation.approved", (rec: EscalationRecord) => {
      this.stream.publish({
        eventType: "ESCALATION_APPROVED",
        timestamp: rec.createdAt,
        taskId: rec.taskId,
        actorId: rec.bossId,
        payload: { escalationId: rec.id, managerId: rec.managerId },
        visibility: "internal",
      });
    });

    this.register(bus, "escalation.rejected", (rec: EscalationRecord) => {
      this.stream.publish({
        eventType: "ESCALATION_REJECTED",
        timestamp: rec.createdAt,
        taskId: rec.taskId,
        actorId: rec.bossId,
        payload: { escalationId: rec.id, managerId: rec.managerId },
        visibility: "internal",
      });
    });
  }

  private attachIntervention(bus: EventBus<InterventionEvents>): void {
    this.register(bus, "intervention.created", (rec: InterventionRecord) => {
      this.stream.publish({
        eventType: "INTERVENTION_CREATED",
        timestamp: rec.createdAt,
        taskId: rec.taskId,
        actorId: rec.bossId,
        payload: { interventionId: rec.id, action: rec.action, instruction: rec.instruction },
        visibility: "internal",
      });
    });
  }

  private attachAllocation(bus: EventBus<AllocationEvents>): void {
    this.register(bus, "allocation.created", (alloc: ManagerAllocation) => {
      this.stream.publish({
        eventType: "MANAGER_ALLOCATION_CREATED",
        timestamp: alloc.createdAt,
        projectId: alloc.projectId,
        actorId: alloc.assignedBy,
        agentId: alloc.managerId,
        payload: { allocationId: alloc.id, taskIds: alloc.taskIds },
        visibility: "internal",
      });
    });

    this.register(bus, "allocation.approved", (alloc: ManagerAllocation) => {
      this.stream.publish({
        eventType: "MANAGER_ALLOCATION_APPROVED",
        timestamp: alloc.createdAt,
        projectId: alloc.projectId,
        actorId: alloc.assignedBy,
        agentId: alloc.managerId,
        payload: { allocationId: alloc.id },
        visibility: "internal",
      });
    });

    this.register(bus, "allocation.activated", (alloc: ManagerAllocation) => {
      this.stream.publish({
        eventType: "MANAGER_ALLOCATION_ACTIVATED",
        timestamp: alloc.createdAt,
        projectId: alloc.projectId,
        actorId: alloc.managerId,
        agentId: alloc.managerId,
        payload: { allocationId: alloc.id },
        visibility: "internal",
      });
    });

    this.register(bus, "allocation.rejected", (alloc: ManagerAllocation) => {
      this.stream.publish({
        eventType: "MANAGER_ALLOCATION_REJECTED",
        timestamp: alloc.createdAt,
        projectId: alloc.projectId,
        actorId: alloc.assignedBy,
        agentId: alloc.managerId,
        payload: { allocationId: alloc.id },
        visibility: "internal",
      });
    });
  }

  private attachConference(bus: EventBus<ConferenceEvents>): void {
    this.register(bus, "meeting.created", (meeting: Meeting) => {
      this.stream.publish({
        eventType: "MEETING_CREATED",
        timestamp: meeting.createdAt,
        projectId: meeting.projectId,
        actorId: meeting.calledBy,
        payload: { meetingId: meeting.id, agenda: meeting.agenda },
        visibility: "internal",
      });
    });

    this.register(bus, "meeting.started", (meeting: Meeting) => {
      this.stream.publish({
        eventType: "MEETING_STARTED",
        timestamp: meeting.createdAt,
        projectId: meeting.projectId,
        actorId: meeting.calledBy,
        payload: { meetingId: meeting.id },
        visibility: "internal",
      });
    });

    this.register(bus, "meeting.completed", (meeting: Meeting) => {
      this.stream.publish({
        eventType: "MEETING_COMPLETED",
        timestamp: meeting.completedAt ?? meeting.createdAt,
        projectId: meeting.projectId,
        actorId: meeting.calledBy,
        payload: { meetingId: meeting.id },
        visibility: "internal",
      });
    });

    this.register(bus, "meeting.decision_created", (decision: MeetingDecision) => {
      this.stream.publish({
        eventType: "MEETING_DECISION_CREATED",
        timestamp: decision.createdAt,
        actorId: decision.decidedBy,
        agentId: decision.managerId ?? null,
        payload: { decisionId: decision.id, decisionType: decision.decisionType, summary: decision.summary },
        visibility: "internal",
      });
    });
  }
}
