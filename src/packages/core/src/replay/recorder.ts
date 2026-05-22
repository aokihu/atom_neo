export type RecordedEvent = {
  type: string;
  ts: number;
  payload: unknown;
};

export class PipelineRecorder {
  #enabled: boolean;
  #events = new Map<string, RecordedEvent[]>();
  #maxEvents: number;

  constructor(params: { enabled?: boolean; maxEvents?: number } = {}) {
    this.#enabled = params.enabled ?? false;
    this.#maxEvents = params.maxEvents ?? 10000;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  startTask(taskId: string): void {
    if (!this.#enabled) return;
    this.#events.set(taskId, []);
  }

  record(taskId: string, event: RecordedEvent): void {
    if (!this.#enabled) return;
    const events = this.#events.get(taskId);
    if (!events) return;
    if (events.length < this.#maxEvents) {
      events.push(event);
    }
  }

  endTask(taskId: string): void {
    if (!this.#enabled) return;
  }

  getEvents(taskId: string): RecordedEvent[] {
    return this.#events.get(taskId) ?? [];
  }

  getAllTaskIds(): string[] {
    return [...this.#events.keys()];
  }

  clear(): void {
    this.#events.clear();
  }
}
