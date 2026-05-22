export class PipelineEventBus<TEvents extends Record<string, any>> {
  #handlers = new Map<string, Set<(...args: any[]) => void>>();
  #errorHandler?: (eventName: string, error: unknown) => void;

  on<E extends keyof TEvents & string>(
    eventName: E,
    handler: (payload: TEvents[E]) => void,
  ): () => void {
    if (!this.#handlers.has(eventName)) {
      this.#handlers.set(eventName, new Set());
    }
    this.#handlers.get(eventName)!.add(handler);
    return () => this.#handlers.get(eventName)?.delete(handler);
  }

  emit<E extends keyof TEvents & string>(
    eventName: E,
    payload: TEvents[E],
  ): void {
    const handlers = this.#handlers.get(eventName);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (error) {
        this.#errorHandler?.(eventName, error);
      }
    }
  }

  onHandlerError(handler: (eventName: string, error: unknown) => void): void {
    this.#errorHandler = handler;
  }

  clear(eventName: string): void {
    this.#handlers.delete(eventName);
  }
}
