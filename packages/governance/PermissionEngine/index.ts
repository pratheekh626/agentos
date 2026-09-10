import type { Agent } from "../../core/Agent";

export type PermissionAction =
  | "delegate"
  | "execute_tool"
  | "spend_credits"
  | "approve_work";

export class PermissionEngine {
  hasPermission(
    agent: Agent,
    action: PermissionAction
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

      default:
        return false;
    }
  }

  assertPermission(
    agent: Agent,
    action: PermissionAction
  ): void {
    if (!this.hasPermission(agent, action)) {
      throw new Error(
        `Permission denied: ${agent.id} cannot ${action}`
      );
    }
  }
}
