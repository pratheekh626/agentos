export type AnomalyType =
  | "repeated_failures"
  | "spending_spike"
  | "excessive_delegation"
  | "repeated_denials"
  | "abnormal_activity";

export interface AgentActivity {
  agentId: string;
  recentActions: number;
  failedActions: number;
  deniedActions: number;
  spendingToday: number;
  averageDailySpending: number;
  delegationsToday: number;
  averageDailyDelegations: number;
  activityPerHour: number;
  normalActivityPerHour: number;
}

export interface Anomaly {
  type: AnomalyType;
  severity: "low" | "medium" | "high";
  score: number;
  reason: string;
}

export interface AnomalyResult {
  detected: boolean;
  score: number;
  anomalies: Anomaly[];
  reason: string;
}

export class AnomalyDetectionService {
  analyze(activity: AgentActivity): AnomalyResult {
    const anomalies: Anomaly[] = [];

    if (activity.failedActions >= 3) {
      anomalies.push({
        type: "repeated_failures",
        severity: activity.failedActions >= 5 ? "high" : "medium",
        score: activity.failedActions >= 5 ? 30 : 20,
        reason: "Agent has repeated failed actions",
      });
    }

    if (
      activity.averageDailySpending > 0 &&
      activity.spendingToday >= activity.averageDailySpending * 2
    ) {
      anomalies.push({
        type: "spending_spike",
        severity: activity.spendingToday >= activity.averageDailySpending * 3
          ? "high"
          : "medium",
        score: activity.spendingToday >= activity.averageDailySpending * 3
          ? 30
          : 20,
        reason: "Agent spending is significantly above its normal level",
      });
    }

    if (
      activity.averageDailyDelegations > 0 &&
      activity.delegationsToday >= activity.averageDailyDelegations * 2
    ) {
      anomalies.push({
        type: "excessive_delegation",
        severity: activity.delegationsToday >=
          activity.averageDailyDelegations * 3
          ? "high"
          : "medium",
        score: activity.delegationsToday >=
          activity.averageDailyDelegations * 3
          ? 25
          : 15,
        reason: "Agent is delegating tasks significantly more than usual",
      });
    }

    if (activity.deniedActions >= 3) {
      anomalies.push({
        type: "repeated_denials",
        severity: activity.deniedActions >= 5 ? "high" : "medium",
        score: activity.deniedActions >= 5 ? 25 : 15,
        reason: "Agent has repeatedly attempted denied actions",
      });
    }

    if (
      activity.normalActivityPerHour > 0 &&
      activity.activityPerHour >= activity.normalActivityPerHour * 3
    ) {
      anomalies.push({
        type: "abnormal_activity",
        severity: "high",
        score: 25,
        reason: "Agent activity is significantly above its normal rate",
      });
    }

    const score = Math.min(
      100,
      anomalies.reduce((total, anomaly) => total + anomaly.score, 0)
    );

    return {
      detected: anomalies.length > 0,
      score,
      anomalies,
      reason:
        anomalies.length === 0
          ? "No anomalous behavior detected"
          : `${anomalies.length} anomalous behavior pattern(s) detected`,
    };
  }
}
