export type A2AMessageType =
  | "request"
  | "response"
  | "delegation"
  | "status_update"
  | "resource_request"
  | "approval_request"
  | "notification";

export interface A2AMessage {
  id: string;

  fromAgentId: string;
  toAgentId: string;

  type: A2AMessageType;

  subject: string;
  content: string;

  taskId: string | null;

  priority: "low" | "medium" | "high" | "critical";

  createdAt: string;
}
