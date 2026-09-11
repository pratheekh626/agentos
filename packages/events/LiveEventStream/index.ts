export type EventVisibility = "public" | "internal" | "admin";

export interface StreamEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
  projectId: string | null;
  taskId: string | null;
  agentId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  visibility: EventVisibility;
}

export type StreamSubscriber = (event: StreamEvent) => void;

export interface LiveEventStreamOptions {
  maxCapacity?: number;
}

export interface PublishStreamEventInput {
  eventId?: string;
  eventType: string;
  timestamp?: string;
  projectId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  actorId?: string | null;
  payload?: Record<string, unknown>;
  visibility?: EventVisibility;
}

export class LiveEventStream {
  private readonly maxCapacity: number;
  private readonly events: StreamEvent[] = [];
  private readonly subscribers = new Set<StreamSubscriber>();
  private eventCounter = 0;

  constructor(options: LiveEventStreamOptions = {}) {
    this.maxCapacity = options.maxCapacity ?? 1000;
  }

  publish(input: PublishStreamEventInput): StreamEvent {
    const event: StreamEvent = {
      eventId: input.eventId ?? `evt-${++this.eventCounter}-${Date.now()}`,
      eventType: input.eventType,
      timestamp: input.timestamp ?? new Date().toISOString(),
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      agentId: input.agentId ?? null,
      actorId: input.actorId ?? null,
      payload: input.payload ?? {},
      visibility: input.visibility ?? "public",
    };

    this.events.push(event);

    if (this.events.length > this.maxCapacity) {
      this.events.shift();
    }

    for (const subscriber of Array.from(this.subscribers)) {
      try {
        subscriber(event);
      } catch {
        // Subscribers must not crash the stream
      }
    }

    return event;
  }

  subscribe(subscriber: StreamSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  getRecent(limit?: number): StreamEvent[] {
    const slice = limit !== undefined ? this.events.slice(-limit) : [...this.events];
    return slice;
  }

  getByProject(projectId: string, limit?: number): StreamEvent[] {
    const filtered = this.events.filter((e) => e.projectId === projectId);
    return limit !== undefined ? filtered.slice(-limit) : filtered;
  }

  getByTask(taskId: string, limit?: number): StreamEvent[] {
    const filtered = this.events.filter((e) => e.taskId === taskId);
    return limit !== undefined ? filtered.slice(-limit) : filtered;
  }

  getByAgent(agentId: string, limit?: number): StreamEvent[] {
    const filtered = this.events.filter(
      (e) => e.agentId === agentId || e.actorId === agentId
    );
    return limit !== undefined ? filtered.slice(-limit) : filtered;
  }

  getByType(eventType: string, limit?: number): StreamEvent[] {
    const filtered = this.events.filter((e) => e.eventType === eventType);
    return limit !== undefined ? filtered.slice(-limit) : filtered;
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  getEventCount(): number {
    return this.events.length;
  }

  clear(): void {
    this.events.length = 0;
  }
}
