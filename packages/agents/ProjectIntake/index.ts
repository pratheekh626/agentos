import type { AgentRegistry } from "../AgentRegistry";
import type { StructuredRequirement } from "../RequirementUnderstanding";

export type ProjectIntakeDecision =
  | "ACCEPTED"
  | "NEEDS_CLARIFICATION"
  | "REJECTED";

export type ProjectStatus = "planned";

export interface Project {
  id: string;
  requirementId: string;
  clientId: string;
  objective: string;
  status: ProjectStatus;
  createdAt: string;
}

export interface ProjectIntakeResult {
  decision: ProjectIntakeDecision;
  project: Project | null;
  requirement: StructuredRequirement;
  reason: string;
}

export class ProjectIntakeService {
  private readonly projects = new Map<string, Project>();

  constructor(
    private readonly registry: AgentRegistry
  ) {}

  intake(
    projectId: string,
    callerId: string,
    requirement: StructuredRequirement,
    createdAt = new Date().toISOString()
  ): ProjectIntakeResult {
    if (!projectId.trim()) {
      return this.rejected(
        requirement,
        "Project ID is required"
      );
    }

    const caller = this.registry.get(callerId);

    if (!caller || caller.role !== "boss") {
      return this.rejected(
        requirement,
        "Only a registered Boss can accept requirements"
      );
    }

    if (requirement.status === "needs_clarification") {
      return {
        decision: "NEEDS_CLARIFICATION",
        project: null,
        requirement,
        reason:
          "Requirement needs clarification before project intake",
      };
    }

    if (this.projects.has(projectId)) {
      throw new Error(`Project already exists: ${projectId}`);
    }

    const project: Project = {
      id: projectId,
      requirementId: requirement.id,
      clientId: requirement.clientId,
      objective: requirement.objective,
      status: "planned",
      createdAt,
    };

    this.projects.set(project.id, project);

    return {
      decision: "ACCEPTED",
      project,
      requirement,
      reason: "Requirement accepted into a planned project",
    };
  }

  get(projectId: string): Project | undefined {
    return this.projects.get(projectId);
  }

  getAll(): Project[] {
    return Array.from(this.projects.values());
  }

  private rejected(
    requirement: StructuredRequirement,
    reason: string
  ): ProjectIntakeResult {
    return {
      decision: "REJECTED",
      project: null,
      requirement,
      reason,
    };
  }
}