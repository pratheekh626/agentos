export type TaskStatus =
  | "queued"
  | "assigned"
  | "in_progress"
  | "blocked"
  | "verification"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskPriority =
  | "low"
  | "medium"
  | "high"
  | "critical";

export interface Task {
  id: string;
  title: string;
  description: string;

  assignedTo: string | null;
  createdBy: string;

  status: TaskStatus;
  priority: TaskPriority;

  dependencies: string[];

  budget: number;
  spent: number;

  createdAt: string;
  updatedAt: string;
}
