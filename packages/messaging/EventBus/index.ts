export type EventHandler<T> = (event: T) => void;

export class EventBus<TEventMap extends Record<string, unknown>> {
  private handlers = new Map<
    keyof TEventMap,
    Set<EventHandler<unknown>>
  >();

  on<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap[K]>
  ): void {
    const handlers =
      this.handlers.get(eventName) ?? new Set<EventHandler<unknown>>();

    handlers.add(handler as EventHandler<unknown>);

    this.handlers.set(eventName, handlers);
  }

  emit<K extends keyof TEventMap>(
    eventName: K,
    event: TEventMap[K]
  ): void {
    const handlers = this.handlers.get(eventName);

    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler(event);
    }
  }

  off<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap[K]>
  ): void {
    const handlers = this.handlers.get(eventName);

    if (!handlers) {
      return;
    }

    handlers.delete(handler as EventHandler<unknown>);
  }
}
