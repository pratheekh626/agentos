import type { Agent } from "../../core/Agent";
import type { AccessAction, AccessControlService } from "../AccessControl";
import type { IdentityService } from "../Identity";
import type { RiskEngine } from "../RiskEngine";
import type { AnomalyDetectionService } from "../AnomalyDetection";
import type { KillSwitchService } from "../KillSwitch";

export type SecurityDecision = "ALLOW" | "ESCALATE" | "DENY";

export interface SecurityCheckRequest {
  agent: Agent;
  action: AccessAction;
  resource: string;
  amount?: number;
  isNewAgent?: boolean;
  repeatedFailures?: number;
  unusualActivity?: boolean;
  sensitiveAction?: boolean;
  activity?: {
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
  };
}

export interface SecurityCheckResult {
  decision: SecurityDecision;
  agentId: string;
  action: AccessAction;
  reason: string;
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  anomaliesDetected: boolean;
}

export class SecurityGateway {
  constructor(
    private readonly identityService: IdentityService,
    private readonly accessControl: AccessControlService,
    private readonly riskEngine: RiskEngine,
    private readonly anomalyDetection: AnomalyDetectionService,
    private readonly killSwitch: KillSwitchService
  ) {}

  check(request: SecurityCheckRequest): SecurityCheckResult {
    const { agent } = request;

    if (this.killSwitch.isOrganizationStopped()) {
      return this.deny(
        agent.id,
        request.action,
        "Organization emergency stop is active"
      );
    }

    if (this.killSwitch.isAgentStopped(agent.id)) {
      return this.deny(
        agent.id,
        request.action,
        `Agent ${agent.id} is stopped by the kill switch`
      );
    }

    if (!this.identityService.isActive(agent.id)) {
      return this.deny(
        agent.id,
        request.action,
        "Agent identity is not active"
      );
    }

    const access = this.accessControl.check({
      agent,
      action: request.action,
      resource: request.resource,
    });

    if (access.decision === "DENY") {
      return this.deny(
        agent.id,
        request.action,
        access.reason
      );
    }

    const risk = this.riskEngine.calculate({
      agentId: agent.id,
      action: request.action,
      amount: request.amount,
      trustScore: agent.trustScore,
      isNewAgent: request.isNewAgent,
      repeatedFailures: request.repeatedFailures,
      unusualActivity: request.unusualActivity,
      sensitiveAction: request.sensitiveAction,
    });

    const activity = request.activity ?? {
      agentId: agent.id,
      recentActions: 0,
      failedActions: request.repeatedFailures ?? 0,
      deniedActions: 0,
      spendingToday: request.amount ?? 0,
      averageDailySpending: 0,
      delegationsToday: 0,
      averageDailyDelegations: 0,
      activityPerHour: 0,
      normalActivityPerHour: 0,
    };

    const anomaly = this.anomalyDetection.analyze(activity);

    if (risk.level === "high") {
      return {
        decision: "DENY",
        agentId: agent.id,
        action: request.action,
        reason: risk.reason,
        riskScore: risk.score,
        riskLevel: risk.level,
        anomaliesDetected: anomaly.detected,
      };
    }

    if (anomaly.detected) {
      return {
        decision: "ESCALATE",
        agentId: agent.id,
        action: request.action,
        reason: anomaly.reason,
        riskScore: risk.score,
        riskLevel: risk.level,
        anomaliesDetected: true,
      };
    }

    if (risk.level === "medium") {
      return {
        decision: "ESCALATE",
        agentId: agent.id,
        action: request.action,
        reason: risk.reason,
        riskScore: risk.score,
        riskLevel: risk.level,
        anomaliesDetected: false,
      };
    }

    return {
      decision: "ALLOW",
      agentId: agent.id,
      action: request.action,
      reason: "All security checks passed",
      riskScore: risk.score,
      riskLevel: risk.level,
      anomaliesDetected: false,
    };
  }

  private deny(
    agentId: string,
    action: AccessAction,
    reason: string
  ): SecurityCheckResult {
    return {
      decision: "DENY",
      agentId,
      action,
      reason,
      riskScore: 100,
      riskLevel: "high",
      anomaliesDetected: false,
    };
  }
}
