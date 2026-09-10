export type EvidenceType =
  | "file"
  | "url"
  | "screenshot"
  | "test_result"
  | "log"
  | "report";

export interface Evidence {
  id: string;
  taskId: string;
  agentId: string;

  type: EvidenceType;

  title: string;
  description: string;
  reference: string;

  createdAt: string;
}

export class EvidenceService {
  private evidence = new Map<string, Evidence>();

  create(
    id: string,
    taskId: string,
    agentId: string,
    type: EvidenceType,
    title: string,
    description: string,
    reference: string
  ): Evidence {
    if (this.evidence.has(id)) {
      throw new Error(`Evidence already exists: ${id}`);
    }

    if (!taskId) {
      throw new Error("Task ID is required");
    }

    if (!agentId) {
      throw new Error("Agent ID is required");
    }

    if (!title.trim()) {
      throw new Error("Evidence title is required");
    }

    if (!reference.trim()) {
      throw new Error("Evidence reference is required");
    }

    const item: Evidence = {
      id,
      taskId,
      agentId,
      type,
      title,
      description,
      reference,
      createdAt: new Date().toISOString(),
    };

    this.evidence.set(id, item);

    return item;
  }

  get(id: string): Evidence | undefined {
    return this.evidence.get(id);
  }

  getByTask(taskId: string): Evidence[] {
    return Array.from(this.evidence.values()).filter(
      (item) => item.taskId === taskId
    );
  }

  getByAgent(agentId: string): Evidence[] {
    return Array.from(this.evidence.values()).filter(
      (item) => item.agentId === agentId
    );
  }

  getAll(): Evidence[] {
    return Array.from(this.evidence.values());
  }

  remove(id: string): boolean {
    return this.evidence.delete(id);
  }
}
