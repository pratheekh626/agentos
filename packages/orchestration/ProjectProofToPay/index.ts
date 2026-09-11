import type { Agent } from "../../core/Agent";
import type { ExecutionRecord } from "../../agents/Execution";
import type { EvidenceService } from "../../verification/Evidence";
import type { VerificationCheck } from "../../verification/Verification";
import type { QACheck } from "../../verification/QA";
import {
  ProofToPayService,
  type ProofToPayRequest,
  type ProofToPayResult,
} from "../../verification/ProofToPay";

export interface ProjectProofToPayResult {
  decision: "PAID" | "ESCALATED" | "DENIED" | "REJECTED";
  payment: ProofToPayResult | null;
  reason: string;
}

export class ProjectProofToPayService {
  private readonly requests = new Set<string>();

  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly proofToPay: ProofToPayService
  ) {}

  pay(
    execution: ExecutionRecord,
    verification: VerificationCheck,
    qa: QACheck,
    request: ProofToPayRequest
  ): ProjectProofToPayResult {
    const validationError = this.validateProof(
      execution,
      verification,
      qa,
      request
    );

    if (validationError) {
      return this.rejected(validationError);
    }

    if (this.requests.has(request.id)) {
      return this.rejected(
        `Payment request already exists: ${request.id}`
      );
    }

    this.requests.add(request.id);
    const payment = this.proofToPay.pay(request);

    if (payment.status === "paid") {
      return {
        decision: "PAID",
        payment,
        reason: payment.reason,
      };
    }

    if (payment.status === "awaiting_approval") {
      return {
        decision: "ESCALATED",
        payment,
        reason: payment.reason,
      };
    }

    return {
      decision: "DENIED",
      payment,
      reason: payment.reason,
    };
  }

  private validateProof(
    execution: ExecutionRecord,
    verification: VerificationCheck,
    qa: QACheck,
    request: ProofToPayRequest
  ): string | null {
    if (execution.status !== "completed") {
      return "Execution must be completed before payment";
    }

    if (!execution.evidenceId) {
      return "Execution evidence is required before payment";
    }

    const evidence = this.evidenceService.get(execution.evidenceId);

    if (!evidence) {
      return "Execution evidence was not found";
    }

    if (verification.status !== "passed") {
      return "Verification must be passed before payment";
    }

    if (qa.status !== "passed") {
      return "QA must be passed before payment";
    }

    if (
      execution.taskId !== verification.taskId ||
      execution.taskId !== qa.taskId ||
      execution.taskId !== request.taskId ||
      evidence.taskId !== execution.taskId
    ) {
      return "Execution, evidence, verification, QA, and payment tasks must match";
    }

    if (!verification.evidenceIds.includes(evidence.id)) {
      return "Verification does not include execution evidence";
    }

    if (request.agent.id !== evidence.agentId) {
      return "Payment requester must be the execution worker";
    }

    return null;
  }

  private rejected(reason: string): ProjectProofToPayResult {
    return {
      decision: "REJECTED",
      payment: null,
      reason,
    };
  }
}