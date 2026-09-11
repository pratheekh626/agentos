import type { Agent } from "../../core/Agent";
import type { ExecutionRecord } from "../../agents/Execution";
import type { AgentRegistry } from "../../agents/AgentRegistry";
import type { EvidenceService } from "../../verification/Evidence";
import type {
  VerificationCheck,
  VerificationService,
} from "../../verification/Verification";

export interface ProjectVerificationResult {
  decision: "CREATED" | "PASSED" | "FAILED" | "REJECTED";
  verification: VerificationCheck | null;
  reason: string;
}

export class ProjectVerificationService {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly evidenceService: EvidenceService,
    private readonly verificationService: VerificationService
  ) {}

  request(
    execution: ExecutionRecord,
    verifier: Agent,
    verificationId: string
  ): ProjectVerificationResult {
    const validationError = this.validateExecution(
      execution,
      verifier
    );

    if (validationError) {
      return this.rejected(validationError);
    }

    if (!verificationId.trim()) {
      return this.rejected("Verification ID is required");
    }

    if (this.verificationService.get(verificationId)) {
      return this.rejected(
        `Verification already exists: ${verificationId}`
      );
    }

    const evidence = this.evidenceService.get(
      execution.evidenceId!
    );

    if (!evidence || evidence.taskId !== execution.taskId) {
      return this.rejected(
        "Evidence does not belong to the execution task"
      );
    }

    const verification = this.verificationService.create(
      verificationId,
      execution.taskId,
      [evidence]
    );

    return {
      decision: "CREATED",
      verification,
      reason: "Independent verification requested",
    };
  }

  pass(
    verificationId: string,
    verifier: Agent,
    score: number,
    reason: string
  ): ProjectVerificationResult {
    const validationError = this.validateVerifier(verifier);

    if (validationError) {
      return this.rejected(validationError);
    }

    const verification = this.verificationService.pass(
      verificationId,
      score,
      reason,
      verifier.id
    );

    return {
      decision: "PASSED",
      verification,
      reason: "Verification passed",
    };
  }

  fail(
    verificationId: string,
    verifier: Agent,
    score: number,
    reason: string
  ): ProjectVerificationResult {
    const validationError = this.validateVerifier(verifier);

    if (validationError) {
      return this.rejected(validationError);
    }

    const verification = this.verificationService.fail(
      verificationId,
      score,
      reason,
      verifier.id
    );

    return {
      decision: "FAILED",
      verification,
      reason: "Verification failed",
    };
  }

  private validateExecution(
    execution: ExecutionRecord,
    verifier: Agent
  ): string | null {
    if (execution.status !== "completed") {
      return "Execution must be completed before verification";
    }

    if (!execution.evidenceId) {
      return "Execution must contain evidence before verification";
    }

    const evidence = this.evidenceService.get(execution.evidenceId);

    if (!evidence) {
      return "Execution evidence was not found";
    }

    if (evidence.taskId !== execution.taskId) {
      return "Execution evidence belongs to a different task";
    }

    if (execution.agentId === verifier.id) {
      return "Worker cannot verify its own execution";
    }

    return this.validateVerifier(verifier);
  }

  private validateVerifier(verifier: Agent): string | null {
    const registeredVerifier = this.registry.get(verifier.id);

    if (!registeredVerifier) {
      return "Verifier is not registered";
    }

    if (!registeredVerifier.permissions.canApproveWork) {
      return "Verifier does not have verification approval capability";
    }

    return null;
  }

  private rejected(reason: string): ProjectVerificationResult {
    return {
      decision: "REJECTED",
      verification: null,
      reason,
    };
  }
}