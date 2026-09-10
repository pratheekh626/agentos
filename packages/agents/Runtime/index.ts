import type { Agent } from "../../core/Agent";
import type { Task, TaskPriority } from "../../core/Task";
import type { AgentRegistry } from "../AgentRegistry";

import { TaskDispatcher } from "../../orchestration/TaskDispatcher";
import { DependencyManager } from "../../orchestration/Dependencies";
import {
  DelegationService,
  type DelegationResult,
} from "../../orchestration/Delegation";
import {
  Scheduler,
  type ScheduleResult,
} from "../../orchestration/Scheduler";

import type {
  A2AMessage,
  A2AMessageType,
} from "../../messaging/A2A";
import { AgentMessageService } from "../../messaging/AgentMessages";
import { EventBus } from "../../messaging/EventBus";

export type AgentRuntimeEvents = {
  "task.created": Task;
  "task.scheduled": ScheduleResult;
  "task.started": Task;
  "task.completed": Task;
  "agent.message_sent": A2AMessage;
  "agent.status_changed": {
    agentId: string;
    previousStatus: Agent["status"];
    status: Agent["status"];
  };
} & Record<string, unknown>;

export interface RuntimeMessageInput {
  fromAgentId: string;
  toAgentId: string;
  type: A2AMessageType;
  subject: string;
  content: string;
  taskId?: string | null;
  priority?: A2AMessage["priority"];
}

export interface RuntimeTaskInput {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  priority?: TaskPriority;
  budget?: number;
}

export interface RuntimeSubtaskInput {
  id: string;
  title: string;
  description: string;
  priority?: TaskPriority;
  budget?: number;
  dependencies?: string[];
}

export interface RuntimeAssignmentResult {
  delegation: DelegationResult;
  message: A2AMessage | null;
}

export class AgentRuntime {
  readonly events = new EventBus<AgentRuntimeEvents>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly taskDispatcher: TaskDispatcher,
    private readonly dependencyManager: DependencyManager,
    private readonly delegationService: DelegationService,
    private readonly scheduler: Scheduler,
    private readonly messages: AgentMessageService
  ) {}

  createTask(input: RuntimeTaskInput): Task {
    const task = this.taskDispatcher.createTask(
      input.id,
      input.title,
      input.description,
      input.createdBy,
      input.priority,
      input.budget
    );

    this.events.emit("task.created", task);

    return task;
  }

  decomposeTask(
    task: Task,
    manager: Agent,
    subtasks: RuntimeSubtaskInput[]
  ): Task[] {
    const registeredManager = this.registry.get(manager.id);

    if (
      !registeredManager ||
      registeredManager.role !== "manager"
    ) {
      throw new Error(
        "Only registered manager agents can decompose tasks"
      );
    }

    if (
      task.createdBy !== manager.id &&
      task.assignedTo !== manager.id
    ) {
      throw new Error(
        "Manager does not own this task"
      );
    }

    return subtasks.map((input) => {
      const subtask = this.taskDispatcher.createTask(
        input.id,
        input.title,
        input.description,
        manager.id,
        input.priority,
        input.budget
      );

      return {
        ...subtask,
        dependencies: input.dependencies ?? [],
      };
    });
  }

  assignSubtask(
    task: Task,
    manager: Agent,
    worker: Agent,
    riskScore = 0
  ): RuntimeAssignmentResult {
    const delegation = this.delegationService.delegate(
      manager,
      worker,
      task,
      riskScore
    );

    if (
      delegation.decision !== "ALLOW" ||
      !delegation.task
    ) {
      return {
        delegation,
        message: null,
      };
    }

    const message = this.sendMessage({
      fromAgentId: manager.id,
      toAgentId: worker.id,
      type: "delegation",
      subject: `Subtask assigned: ${task.title}`,
      content: task.description,
      taskId: task.id,
      priority: task.priority,
    });

    return {
      delegation,
      message,
    };
  }

  schedule(
    tasks: Map<string, Task>,
    manager: Agent,
    riskScore = 0
  ): ScheduleResult {
    const result = this.scheduler.schedule(
      tasks,
      manager,
      riskScore
    );

    this.events.emit("task.scheduled", result);

    if (
      result.decision === "SCHEDULED" &&
      result.task?.assignedTo
    ) {
      this.emitStatusChanged(
        result.task.assignedTo,
        "idle",
        "working"
      );
    }

    return result;
  }

  startTask(task: Task): Task {
    const started = this.taskDispatcher.startTask(task);

    this.events.emit("task.started", started);

    if (started.assignedTo) {
      const agent = this.registry.get(started.assignedTo);

      if (agent) {
        this.emitStatusChanged(
          started.assignedTo,
          agent.status,
          "working"
        );
      }
    }

    return started;
  }

  completeTask(task: Task): Task {
    const completed = this.taskDispatcher.completeTask(task);

    this.events.emit("task.completed", completed);

    if (completed.assignedTo) {
      this.emitStatusChanged(
        completed.assignedTo,
        "working",
        "idle"
      );
    }

    return completed;
  }

  sendMessage(input: RuntimeMessageInput): A2AMessage {
    const from = this.registry.get(input.fromAgentId);
    const to = this.registry.get(input.toAgentId);

    if (!from) {
      throw new Error(
        `Sender agent not found: ${input.fromAgentId}`
      );
    }

    if (!to) {
      throw new Error(
        `Recipient agent not found: ${input.toAgentId}`
      );
    }

    const message: A2AMessage = {
      id: `msg-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      fromAgentId: from.id,
      toAgentId: to.id,
      type: input.type,
      subject: input.subject,
      content: input.content,
      taskId: input.taskId ?? null,
      priority: input.priority ?? "medium",
      createdAt: new Date().toISOString(),
    };

    const stored = this.messages.send(message);

    this.events.emit("agent.message_sent", stored);

    return stored;
  }

  delegate(
    from: Agent,
    to: Agent,
    task: Task,
    riskScore = 0
  ): DelegationResult {
    return this.delegationService.delegate(
      from,
      to,
      task,
      riskScore
    );
  }

  getAgent(agentId: string): Agent | undefined {
    return this.registry.get(agentId);
  }

  getTaskDependencies(
    task: Task,
    tasks: Map<string, Task>
  ): Task[] {
    return this.dependencyManager.getBlockedDependencies(
      task,
      tasks
    );
  }

  getMessagesForAgent(agentId: string): A2AMessage[] {
    return this.messages.getByAgent(agentId);
  }

  private emitStatusChanged(
    agentId: string,
    previousStatus: Agent["status"],
    status: Agent["status"]
  ): void {
    this.events.emit("agent.status_changed", {
      agentId,
      previousStatus,
      status,
    });
  }
}
