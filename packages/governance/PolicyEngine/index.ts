import type { Agent } from "../../core/Agent";

export type PolicyDecision =
  | "ALLOW"
  | "DENY"
  | "ESCALATE";

export interface PolicyRequest {
  agent: Agent;
  action:
    | "delegate"
    | "execute_tool"
    | "spend_credits"
    | "approve_work";

  riskScore: number;
  amount?: number;
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

export class PolicyEngine {
  evaluate(request: PolicyRequest): PolicyResult {
    const {
      agent,
      action,
      riskScore,
      amount = 0,
    } = request;

    if (agent.status === "paused") {
      return {
        decision: "DENY",
        reason: "Agent is paused",
      };
    }

    if (agent.status === "offline") {
      return {
        decision: "DENY",
        reason: "Agent is offline",
      };
    }

    if (riskScore >= 80) {
      return {
        decision: "DENY",
        reason: "Risk score is too high",
      };
    }

    if (riskScore >= 50) {
      return {
        decision: "ESCALATE",
        reason: "Action requires human approval",
      };
    }

    if (
      action === "spend_credits" &&
      amount > 500
    ) {
      return {
        decision: "ESCALATE",
        reason: "Transaction exceeds autonomous spending limit",
      };
    }

    return {
      decision: "ALLOW",
      reason: "Action satisfies current policy",
    };
  }
}
