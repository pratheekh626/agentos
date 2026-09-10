import type { Agent } from "../../core/Agent";

export class AgentRegistry {
  private agents = new Map<string, Agent>();

  register(agent: Agent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent already registered: ${agent.id}`);
    }

    this.agents.set(agent.id, agent);
  }

  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  getAll(): Agent[] {
    return Array.from(this.agents.values());
  }

  getByRole(role: Agent["role"]): Agent[] {
    return this.getAll().filter((agent) => agent.role === role);
  }

  getChildren(managerId: string): Agent[] {
    return this.getAll().filter(
      (agent) => agent.managerId === managerId
    );
  }

  update(agentId: string, updates: Partial<Agent>): Agent {
    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const updatedAgent = {
      ...agent,
      ...updates,
    };

    this.agents.set(agentId, updatedAgent);

    return updatedAgent;
  }

  remove(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  count(): number {
    return this.agents.size;
  }
}
