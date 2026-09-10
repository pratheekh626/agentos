import type { Agent } from "../../core/Agent";

export function createWorker(
  id: string,
  name: string,
  managerId: string
): Agent {
  return {
    id,
    name,
    role: "worker",
    managerId,
    status: "idle",

    permissions: {
      canDelegate: false,
      canExecuteTools: true,
      canSpendCredits: true,
      canApproveWork: false,
    },

    trustScore: 90,

    createdAt: new Date().toISOString(),
  };
}
