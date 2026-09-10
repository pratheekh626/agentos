import type { Agent } from "../../core/Agent";

export function createManager(
  id: string,
  name: string,
  bossId: string
): Agent {
  return {
    id,
    name,
    role: "manager",
    managerId: bossId,
    status: "idle",

    permissions: {
      canDelegate: true,
      canExecuteTools: true,
      canSpendCredits: true,
      canApproveWork: false,
    },

    trustScore: 95,

    createdAt: new Date().toISOString(),
  };
}
