import type { EvidenceService } from "../Evidence";
import type { VerificationService } from "../Verification";
import type { QAService } from "../QA";
import type { CreditEngine, CreditResult } from "../../economy/CreditEngine";
import type { Agent } from "../../core/Agent";

export type ProofToPayStatus =
  | "pending"
  | "paid"
  | "rejected"
  | "awaiting_approval";

export interface ProofToPayRequest {
  id: string;
  agent: Agent;
  taskId: string;
  amount: number;
  reason: string;
  riskScore: number;
  budgetId: string;
}

export interface ProofToPayResult {
  status: ProofToPayStatus;
  creditResult: CreditResult | null;
  reason: string;
}

export class ProofToPayService {
  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly verificationService: VerificationService,
    private readonly qaService: QAService,
    private readonly creditEngine: CreditEngine
  ) {}

  pay(request: ProofToPayRequest): ProofToPayResult {
    const {
      id,
      agent,
      taskId,
      amount,
      reason,
      riskScore,
      budgetId,
    } = request;

    const evidence =
      this.evidenceService.getByTask(taskId);

    if (evidence.length === 0) {
      return {
        status: "rejected",
        creditResult: null,
        reason: "Payment requires task evidence",
      };
    }

    const verifications =
      this.verificationService.getByTask(taskId);

    const passedVerification =
      verifications.some(
        (check) => check.status === "passed"
      );

    if (!passedVerification) {
      return {
        status: "rejected",
        creditResult: null,
        reason: "Payment requires passed verification",
      };
    }

    const qaChecks =
      this.qaService.getByTask(taskId);

    const passedQA =
      qaChecks.some(
        (check) => check.status === "passed"
      );

    if (!passedQA) {
      return {
        status: "rejected",
        creditResult: null,
        reason: "Payment requires passed QA",
      };
    }

    const creditResult =
      this.creditEngine.requestCredits({
        id,
        agent,
        amount,
        reason,
        taskId,
        riskScore,
        budgetId,
      });

    if (creditResult.decision === "ALLOW") {
      return {
        status: "paid",
        creditResult,
        reason:
          "Proof verified and payment released",
      };
    }

    if (
      creditResult.decision === "ESCALATE"
    ) {
      return {
        status: "awaiting_approval",
        creditResult,
        reason:
          "Proof verified but payment requires approval",
      };
    }

    return {
      status: "rejected",
      creditResult,
      reason: creditResult.reason,
    };
  }
}
