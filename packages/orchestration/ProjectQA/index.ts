import type { Agent } from "../../core/Agent";
import type { AgentRegistry } from "../../agents/AgentRegistry";
import type { EvidenceService } from "../../verification/Evidence";
import type {
  VerificationCheck,
} from "../../verification/Verification";
import type {
  QACheck,
  QAService,
} from "../../verification/QA";

export interface ProjectQAResult {
  decision: "CREATED" | "PASSED" | "FAILED" | "REJECTED";
  qa: QACheck | null;
  reason: string;
}

export class ProjectQAService {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly evidenceService: EvidenceService,
    private readonly qaService: QAService
  ) {}

  request(
    verification: VerificationCheck,
    qaAgent: Agent,
    qaId: string,
    checks: string[]
  ): ProjectQAResult {
    const validationError = this.validateVerification(
      verification,
      qaAgent
    );

    if (validationError) {
      return this.rejected(validationError);
    }

    if (!qaId.trim()) {
      return this.rejected("QA ID is required");
    }

    if (this.qaService.get(qaId)) {
      return this.rejected(`QA check already exists: ${qaId}`);
    }

    if (checks.length === 0) {
      return this.rejected("At least one QA check is required");
    }

    const qa = this.qaService.create(
      qaId,
      verification.taskId,
      checks
    );

    return {
      decision: "CREATED",
      qa,
      reason: "Independent QA requested",
    };
  }

  pass(
    qaId: string,
    qaAgent: Agent,
    score: number
  ): ProjectQAResult {
    const validationError = this.validateQAAgent(qaAgent);

    if (validationError) {
      return this.rejected(validationError);
    }

    const qa = this.qaService.pass(
      qaId,
      score,
      qaAgent.id
    );

    return {
      decision: "PASSED",
      qa,
      reason: "QA passed",
    };
  }

  fail(
    qaId: string,
    qaAgent: Agent,
    score: number,
    issues: string[]
  ): ProjectQAResult {
    const validationError = this.validateQAAgent(qaAgent);

    if (validationError) {
      return this.rejected(validationError);
    }

    const qa = this.qaService.fail(
      qaId,
      score,
      issues,
      qaAgent.id
    );

    return {
      decision: "FAILED",
      qa,
      reason: "QA failed",
    };
  }

  private validateVerification(
    verification: VerificationCheck,
    qaAgent: Agent
  ): string | null {
    if (verification.status !== "passed") {
      return "Only passed verification can proceed to QA";
    }

    if (!verification.taskId.trim()) {
      return "Verification task ID is required";
    }

    if (verification.evidenceIds.length === 0) {
      return "Verification must contain evidence before QA";
    }

    const workerIds = new Set(
      verification.evidenceIds
        .map((evidenceId) => this.evidenceService.get(evidenceId))
        .filter((evidence) => evidence?.taskId === verification.taskId)
        .map((evidence) => evidence!.agentId)
    );

    if (workerIds.has(qaAgent.id)) {
      return "Worker cannot perform QA on its own task";
    }

    return this.validateQAAgent(qaAgent);
  }

  private validateQAAgent(qaAgent: Agent): string | null {
    const registered = this.registry.get(qaAgent.id);

    if (!registered) {
      return "QA agent is not registered";
    }

    if (!registered.permissions.canApproveWork) {
      return "QA agent does not have QA approval capability";
    }

    return null;
  }

  private rejected(reason: string): ProjectQAResult {
    return {
      decision: "REJECTED",
      qa: null,
      reason,
    };
  }
}