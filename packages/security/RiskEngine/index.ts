export type RiskFactorType =
  | "high_value_transaction"
  | "sensitive_action"
  | "new_agent"
  | "low_trust"
  | "repeated_failures"
  | "unusual_activity";

export interface RiskFactor {
  type: RiskFactorType;
  score: number;
  reason: string;
}

export interface RiskRequest {
  agentId: string;
  action: string;
  amount?: number;
  trustScore: number;
  isNewAgent?: boolean;
  repeatedFailures?: number;
  unusualActivity?: boolean;
  sensitiveAction?: boolean;
}

export interface RiskResult {
  score: number;
  level: "low" | "medium" | "high";
  factors: RiskFactor[];
  reason: string;
}

export class RiskEngine {
  calculate(request: RiskRequest): RiskResult {
    const factors: RiskFactor[] = [];

    if (request.amount !== undefined) {
      if (request.amount > 500) {
        factors.push({
          type: "high_value_transaction",
          score: 30,
          reason: "Transaction amount exceeds the normal threshold",
        });
      } else if (request.amount > 250) {
        factors.push({
          type: "high_value_transaction",
          score: 15,
          reason: "Transaction amount is moderately high",
        });
      }
    }

    if (request.sensitiveAction) {
      factors.push({
        type: "sensitive_action",
        score: 25,
        reason: "Action affects a sensitive resource",
      });
    }

    if (request.isNewAgent) {
      factors.push({
        type: "new_agent",
        score: 15,
        reason: "Agent has limited operating history",
      });
    }

    if (request.trustScore < 70) {
      factors.push({
        type: "low_trust",
        score: 20,
        reason: "Agent trust score is below the safe threshold",
      });
    }

    if ((request.repeatedFailures ?? 0) >= 3) {
      factors.push({
        type: "repeated_failures",
        score: 20,
        reason: "Agent has multiple recent failures",
      });
    }

    if (request.unusualActivity) {
      factors.push({
        type: "unusual_activity",
        score: 25,
        reason: "Activity pattern differs from expected behavior",
      });
    }

    const score = Math.min(
      100,
      factors.reduce((total, factor) => total + factor.score, 0)
    );

    let level: RiskResult["level"];

    if (score >= 80) {
      level = "high";
    } else if (score >= 50) {
      level = "medium";
    } else {
      level = "low";
    }

    return {
      score,
      level,
      factors,
      reason:
        factors.length === 0
          ? "No significant risk factors detected"
          : `${factors.length} risk factor(s) detected`,
    };
  }
}
