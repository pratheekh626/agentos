import type { Task, TaskPriority } from "../../core/Task";
import type { AgentRegistry } from "../../agents/AgentRegistry";

export class TaskDispatcher {
  constructor(private readonly registry: AgentRegistry) {}

  createTask(
    id: string,
    title: string,
    description: string,
    createdBy: string,
    priority: TaskPriority = "medium",
    budget = 0
  ): Task {
    const creator = this.registry.get(createdBy);

    if (!creator) {
      throw new Error(`Creator agent not found: ${createdBy}`);
    }

    return {
      id,
      title,
      description,
      assignedTo: null,
      createdBy,
      status: "queued",
      priority,
      dependencies: [],
      budget,
      spent: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  assignTask(task: Task, agentId: string): Task {
    const agent = this.registry.get(agentId);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.status === "paused" || agent.status === "offline") {
      throw new Error(
        `Agent ${agentId} cannot receive tasks while ${agent.status}`
      );
    }

    if (agent.role === "boss") {
      throw new Error("Boss agents cannot receive worker tasks");
    }

    this.registry.update(agentId, {
      status: "working",
    });

    return {
      ...task,
      assignedTo: agentId,
      status: "assigned",
      updatedAt: new Date().toISOString(),
    };
  }

  startTask(task: Task): Task {
    if (!task.assignedTo) {
      throw new Error("Task must be assigned before it can start");
    }

    const agent = this.registry.get(task.assignedTo);

    if (!agent) {
      throw new Error(`Assigned agent not found: ${task.assignedTo}`);
    }

    this.registry.update(agent.id, {
      status: "working",
    });

    return {
      ...task,
      status: "in_progress",
      updatedAt: new Date().toISOString(),
    };
  }

  completeTask(task: Task): Task {
    if (task.status !== "in_progress") {
      throw new Error("Only active tasks can be completed");
    }

    if (task.assignedTo) {
      this.registry.update(task.assignedTo, {
        status: "idle",
      });
    }

    return {
      ...task,
      status: "verification",
      updatedAt: new Date().toISOString(),
    };
  }

  finalizeTask(task: Task): Task {
    if (task.status !== "verification") {
      throw new Error(`Only tasks in verification status can be finalized. Current status: ${task.status}`);
    }

    if (task.assignedTo) {
      this.registry.update(task.assignedTo, {
        status: "idle",
      });
    }

    return {
      ...task,
      status: "completed",
      updatedAt: new Date().toISOString(),
    };
  }
}
