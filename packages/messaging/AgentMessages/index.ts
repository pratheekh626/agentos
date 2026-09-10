import type { A2AMessage } from "../A2A";

export interface AgentMessageStore {
  messages: A2AMessage[];
}

export class AgentMessageService {
  private readonly store: AgentMessageStore = {
    messages: [],
  };

  send(message: A2AMessage): A2AMessage {
    this.store.messages.push(message);

    return message;
  }

  getByAgent(agentId: string): A2AMessage[] {
    return this.store.messages.filter(
      (message) =>
        message.fromAgentId === agentId ||
        message.toAgentId === agentId
    );
  }

  getConversation(
    agentA: string,
    agentB: string
  ): A2AMessage[] {
    return this.store.messages.filter(
      (message) =>
        (message.fromAgentId === agentA &&
          message.toAgentId === agentB) ||
        (message.fromAgentId === agentB &&
          message.toAgentId === agentA)
    );
  }

  getByTask(taskId: string): A2AMessage[] {
    return this.store.messages.filter(
      (message) => message.taskId === taskId
    );
  }

  getAll(): A2AMessage[] {
    return [...this.store.messages];
  }
}
