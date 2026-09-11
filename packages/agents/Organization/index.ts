import type { Agent, AgentStatus } from "../../core/Agent";
import type { Task } from "../../core/Task";
import { AgentRegistry } from "../AgentRegistry";

export type OrganizationDepartment =
  | "frontend"
  | "backend"
  | "design"
  | "qa"
  | "security"
  | "research";

export type OrganizationAvailability =
  | "available"
  | "busy"
  | "offline"
  | "paused";

export interface AgentOrganizationProfile {
  agentId: string;
  department: OrganizationDepartment;
  availability: OrganizationAvailability;
  maxConcurrentTasks: number;
  currentTaskCount: number;
}

export interface Organization {
  id: string;
  name: string;
  bossId: string;
  createdAt: string;
}

export class OrganizationService {
  private organization: Organization | null = null;
  private readonly profiles = new Map<string, AgentOrganizationProfile>();

  constructor(private readonly registry: AgentRegistry) {}

  createOrganization(
    id: string,
    name: string,
    bossId: string,
    createdAt = new Date().toISOString()
  ): Organization {
    const boss = this.registry.get(bossId);

    if (!boss || boss.role !== "boss") {
      throw new Error("Organization requires a registered Boss");
    }

    if (this.organization) {
      throw new Error("Organization already exists");
    }

    this.organization = { id, name, bossId, createdAt };
    return this.organization;
  }

  addManager(
    managerId: string,
    department: OrganizationDepartment,
    maxConcurrentTasks = 10
  ): AgentOrganizationProfile {
    return this.addProfile(
      managerId,
      department,
      maxConcurrentTasks
    );
  }

  addWorker(
    workerId: string,
    department: OrganizationDepartment,
    maxConcurrentTasks = 1
  ): AgentOrganizationProfile {
    return this.addProfile(
      workerId,
      department,
      maxConcurrentTasks
    );
  }

  getBoss(): Agent | undefined {
    return this.organization
      ? this.registry.get(this.organization.bossId)
      : undefined;
  }

  getManagers(): Agent[] {
    return this.registry.getByRole("manager");
  }

  getWorkers(): Agent[] {
    return this.registry.getByRole("worker");
  }

  getWorkersForManager(managerId: string): Agent[] {
    return this.registry.getChildren(managerId).filter(
      (agent) => agent.role === "worker"
    );
  }

  getManagerForWorker(workerId: string): Agent | undefined {
    const worker = this.registry.get(workerId);
    return worker?.managerId
      ? this.registry.get(worker.managerId)
      : undefined;
  }

  getOrganization(): Organization | null {
    return this.organization;
  }

  getAgentWorkload(
    workerId: string,
    tasks: Map<string, Task>
  ): AgentOrganizationProfile | undefined {
    const profile = this.profiles.get(workerId);
    if (!profile) return undefined;

    const activeTaskCount = Array.from(tasks.values()).filter(
      (task) =>
        task.assignedTo === workerId &&
        (task.status === "assigned" || task.status === "in_progress")
    ).length;

    return {
      ...profile,
      currentTaskCount: activeTaskCount,
    };
  }

  getAvailableWorkers(tasks: Map<string, Task>): Agent[] {
    return this.getWorkers().filter((worker) => {
      const profile = this.getAgentWorkload(worker.id, tasks);
      return Boolean(
        profile &&
        profile.availability === "available" &&
        worker.status !== "paused" &&
        worker.status !== "offline" &&
        profile.currentTaskCount < profile.maxConcurrentTasks
      );
    });
  }

  updateAgentAvailability(
    agentId: string,
    availability: OrganizationAvailability
  ): AgentOrganizationProfile {
    const profile = this.profiles.get(agentId);
    if (!profile) throw new Error(`Organization profile not found: ${agentId}`);

    const updated = { ...profile, availability };
    this.profiles.set(agentId, updated);
    return updated;
  }

  private addProfile(
    agentId: string,
    department: OrganizationDepartment,
    maxConcurrentTasks: number
  ): AgentOrganizationProfile {
    const agent = this.registry.get(agentId);
    if (!agent || (agent.role !== "manager" && agent.role !== "worker")) {
      throw new Error(`Agent is not a registered manager or worker: ${agentId}`);
    }
    if (maxConcurrentTasks < 1) {
      throw new Error("Maximum concurrent tasks must be positive");
    }

    const profile: AgentOrganizationProfile = {
      agentId,
      department,
      availability: this.availabilityFromStatus(agent.status),
      maxConcurrentTasks,
      currentTaskCount: 0,
    };
    this.profiles.set(agentId, profile);
    return profile;
  }

  private availabilityFromStatus(status: AgentStatus): OrganizationAvailability {
    if (status === "paused") return "paused";
    if (status === "offline") return "offline";
    if (status === "working" || status === "blocked") return "busy";
    return "available";
  }
}