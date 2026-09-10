import type { Evidence } from "../Evidence";

export type VerificationStatus =
  | "pending"
  | "passed"
  | "failed";

export interface VerificationCheck {
  id: string;
  taskId: string;

  evidenceIds: string[];

  status: VerificationStatus;

  score: number;

  reason: string;

  verifiedBy: string | null;

  createdAt: string;
  completedAt: string | null;
}

export class VerificationService {
  private checks = new Map<string, VerificationCheck>();

  create(
    id: string,
    taskId: string,
    evidence: Evidence[]
  ): VerificationCheck {
    if (this.checks.has(id)) {
      throw new Error(`Verification already exists: ${id}`);
    }

    if (!taskId) {
      throw new Error("Task ID is required");
    }

    if (evidence.length === 0) {
      throw new Error(
        "At least one evidence item is required"
      );
    }

    const unrelatedEvidence = evidence.find(
      (item) => item.taskId !== taskId
    );

    if (unrelatedEvidence) {
      throw new Error(
        `Evidence ${unrelatedEvidence.id} does not belong to task ${taskId}`
      );
    }

    const check: VerificationCheck = {
      id,
      taskId,
      evidenceIds: evidence.map(
        (item) => item.id
      ),
      status: "pending",
      score: 0,
      reason: "Verification pending",
      verifiedBy: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this.checks.set(id, check);

    return check;
  }

  pass(
    verificationId: string,
    score: number,
    reason: string,
    verifiedBy: string
  ): VerificationCheck {
    return this.resolve(
      verificationId,
      "passed",
      score,
      reason,
      verifiedBy
    );
  }

  fail(
    verificationId: string,
    score: number,
    reason: string,
    verifiedBy: string
  ): VerificationCheck {
    return this.resolve(
      verificationId,
      "failed",
      score,
      reason,
      verifiedBy
    );
  }

  get(
    verificationId: string
  ): VerificationCheck | undefined {
    return this.checks.get(verificationId);
  }

  getByTask(
    taskId: string
  ): VerificationCheck[] {
    return Array.from(
      this.checks.values()
    ).filter(
      (check) => check.taskId === taskId
    );
  }

  getAll(): VerificationCheck[] {
    return Array.from(
      this.checks.values()
    );
  }

  private resolve(
    verificationId: string,
    status: "passed" | "failed",
    score: number,
    reason: string,
    verifiedBy: string
  ): VerificationCheck {
    const check =
      this.checks.get(verificationId);

    if (!check) {
      throw new Error(
        `Verification not found: ${verificationId}`
      );
    }

    if (check.status !== "pending") {
      throw new Error(
        `Verification already resolved: ${verificationId}`
      );
    }

    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100
    ) {
      throw new Error(
        "Verification score must be between 0 and 100"
      );
    }

    if (!reason.trim()) {
      throw new Error(
        "Verification reason is required"
      );
    }

    if (!verifiedBy.trim()) {
      throw new Error(
        "Verifier is required"
      );
    }

    const updated: VerificationCheck = {
      ...check,
      status,
      score,
      reason,
      verifiedBy,
      completedAt:
        new Date().toISOString(),
    };

    this.checks.set(
      verificationId,
      updated
    );

    return updated;
  }
}
