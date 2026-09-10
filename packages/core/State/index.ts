import type { Agent } from "../Agent";
import type { Task } from "../Task";
import type { OfficeState } from "../Office";

export interface OrganizationState {
  organizationId: string;
  name: string;

  agents: Record<string, Agent>;
  tasks: Record<string, Task>;

  office: OfficeState;

  updatedAt: string;
}
