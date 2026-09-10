import { EventBus } from "../../messaging/EventBus";

export type QAStatus =
  | "pending"
  | "passed"
  | "failed";

export interface QACheck {
  id: string;
  taskId: string;

  checks: string[];

  status: QAStatus;

  score: number;

  issues: string[];

  checkedBy: string | null;

  createdAt: string;
  completedAt: string | null;
}

export interface QAEvents {
  [eventName: string]: unknown;

  "qa.passed": QACheck;
  "qa.failed": QACheck;
}

export class QAService {
  private checks = new Map<string, QACheck>();

  readonly events = new EventBus<QAEvents>();

  create(
    id: string,
    taskId: string,
    checks: string[]
  ): QACheck {
    if (this.checks.has(id)) {
      throw new Error(`QA check already exists: ${id}`);
    }

    if (!taskId) {
      throw new Error("Task ID is required");
    }

    if (checks.length === 0) {
      throw new Error(
        "At least one QA check is required"
      );
    }

    const item: QACheck = {
      id,
      taskId,
      checks: [...checks],
      status: "pending",
      score: 0,
      issues: [],
      checkedBy: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this.checks.set(id, item);

    return item;
  }

  pass(
    id: string,
    score: number,
    checkedBy: string
  ): QACheck {
    return this.resolve(
      id,
      "passed",
      score,
      [],
      checkedBy
    );
  }

  fail(
    id: string,
    score: number,
    issues: string[],
    checkedBy: string
  ): QACheck {
    if (issues.length === 0) {
      throw new Error(
        "Failed QA checks must include issues"
      );
    }

    return this.resolve(
      id,
      "failed",
      score,
      issues,
      checkedBy
    );
  }

  get(id: string): QACheck | undefined {
    return this.checks.get(id);
  }

  getByTask(taskId: string): QACheck[] {
    return Array.from(
      this.checks.values()
    ).filter(
      (check) => check.taskId === taskId
    );
  }

  getAll(): QACheck[] {
    return Array.from(
      this.checks.values()
    );
  }

  private resolve(
    id: string,
    status: "passed" | "failed",
    score: number,
    issues: string[],
    checkedBy: string
  ): QACheck {
    const check = this.checks.get(id);

    if (!check) {
      throw new Error(
        `QA check not found: ${id}`
      );
    }

    if (check.status !== "pending") {
      throw new Error(
        `QA check already resolved: ${id}`
      );
    }

    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100
    ) {
      throw new Error(
        "QA score must be between 0 and 100"
      );
    }

    if (!checkedBy.trim()) {
      throw new Error(
        "QA verifier is required"
      );
    }

    const updated: QACheck = {
      ...check,
      status,
      score,
      issues: [...issues],
      checkedBy,
      completedAt:
        new Date().toISOString(),
    };

    this.checks.set(id, updated);

    if (status === "passed") {
      this.events.emit("qa.passed", updated);
    } else {
      this.events.emit("qa.failed", updated);
    }

    return updated;
  }
}
