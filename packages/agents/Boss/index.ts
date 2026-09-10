import type { Agent } from "../../core/Agent";

export function createBoss(
  id: string,
  name: string
): Agent {
  return {
    id,
    name,
    role: "boss",
    managerId: null,
    status: "idle",

    permissions: {
      canDelegate: true,
      canExecuteTools: true,
      canSpendCredits: true,
      canApproveWork: true,
    },

    trustScore: 100,

    createdAt: new Date().toISOString(),
  };
}
