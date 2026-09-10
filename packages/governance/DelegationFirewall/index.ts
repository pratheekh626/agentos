import type { Agent } from "../../core/Agent";
import {
  PermissionEngine,
} from "../PermissionEngine";
import {
  PolicyEngine,
  type PolicyResult,
} from "../PolicyEngine";

export interface DelegationRequest {
  from: Agent;
  to: Agent;

  taskId: string;

  riskScore: number;
}

export class DelegationFirewall {
  constructor(
    private readonly permissionEngine: PermissionEngine,
    private readonly policyEngine: PolicyEngine
  ) {}

  evaluate(
    request: DelegationRequest
  ): PolicyResult {
    const { from, to, riskScore } = request;

    if (!to) {
      return {
        decision: "DENY",
        reason: "Target agent does not exist",
      };
    }

    if (from.id === to.id) {
      return {
        decision: "DENY",
        reason: "Agent cannot delegate to itself",
      };
    }

    if (!this.permissionEngine.hasPermission(
      from,
      "delegate"
    )) {
      return {
        decision: "DENY",
        reason: "Source agent does not have delegation permission",
      };
    }

    if (from.role === "worker") {
      return {
        decision: "DENY",
        reason: "Worker agents cannot delegate tasks",
      };
    }

    return this.policyEngine.evaluate({
      agent: from,
      action: "delegate",
      riskScore,
    });
  }
}
