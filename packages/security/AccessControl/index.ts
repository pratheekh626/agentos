import type { Agent } from "../../core/Agent";
import type { IdentityService } from "../Identity";

export type AccessAction =
  | "delegate"
  | "execute_tool"
  | "spend_credits"
  | "approve_work"
  | "read"
  | "write";

export type AccessDecision = "ALLOW" | "DENY";

export interface AccessRequest {
  agent: Agent;
  action: AccessAction;
  resource: string;
}

export interface AccessResult {
  decision: AccessDecision;
  reason: string;
}

export class AccessControlService {
  constructor(private readonly identityService: IdentityService) {}

  check(request: AccessRequest): AccessResult {
    const { agent, action, resource } = request;

    if (!resource.trim()) {
      return {
        decision: "DENY",
        reason: "Resource is required",
      };
    }

    if (!this.identityService.isActive(agent.id)) {
      return {
        decision: "DENY",
        reason: "Agent identity is not active",
      };
    }

    const identity = this.identityService.getIdentity(agent.id);

    if (!identity) {
      return {
        decision: "DENY",
        reason: "Agent identity not found",
      };
    }

    if (identity.role !== agent.role) {
      return {
        decision: "DENY",
        reason: "Agent role does not match its identity",
      };
    }

    if (!this.hasPermission(agent, action)) {
      return {
        decision: "DENY",
        reason: `Agent does not have permission for action: ${action}`,
      };
    }

    return {
      decision: "ALLOW",
      reason: `Access granted for ${action} on ${resource}`,
    };
  }

  canAccess(
    agent: Agent,
    action: AccessAction,
    resource: string
  ): boolean {
    return this.check({
      agent,
      action,
      resource,
    }).decision === "ALLOW";
  }

  private hasPermission(
    agent: Agent,
    action: AccessAction
  ): boolean {
    switch (action) {
      case "delegate":
        return agent.permissions.canDelegate;

      case "execute_tool":
        return agent.permissions.canExecuteTools;

      case "spend_credits":
        return agent.permissions.canSpendCredits;

      case "approve_work":
        return agent.permissions.canApproveWork;

      case "read":
      case "write":
        return true;

      default:
        return false;
    }
  }
}
