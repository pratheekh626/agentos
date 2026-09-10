export type OfficeRoom =
  | "boss_cabin"
  | "conference_room"
  | "engineering"
  | "design"
  | "research"
  | "testing"
  | "security"
  | "break_room";

export interface AgentPosition {
  agentId: string;
  room: OfficeRoom;
  x: number;
  y: number;
}

export interface OfficeState {
  organizationId: string;
  positions: AgentPosition[];
  activeMeetingId: string | null;
  updatedAt: string;
}
