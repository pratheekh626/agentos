export type MemoryType =
  | "fact"
  | "decision"
  | "conversation"
  | "task"
  | "observation";

export interface Memory {
  id: string;
  agentId: string;

  type: MemoryType;

  content: string;

  importance: number;

  createdAt: string;
  lastAccessedAt: string;
}
