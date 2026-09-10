export type AgentRole =
  | "boss"
  | "manager"
  | "worker";

export type AgentStatus =
  | "idle"
  | "working"
  | "waiting"
  | "blocked"
  | "paused"
  | "offline";

export interface AgentPermissions {
  canDelegate: boolean;
  canExecuteTools: boolean;
  canSpendCredits: boolean;
  canApproveWork: boolean;
}

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;

  managerId: string | null;

  status: AgentStatus;

  permissions: AgentPermissions;

  trustScore: number;

  createdAt: string;
}
