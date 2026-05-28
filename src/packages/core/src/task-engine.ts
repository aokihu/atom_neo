import { TaskState, BusEvents } from "@atom-neo/shared";
import type { TaskItem, CoreEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import type { TaskQueue } from "./task-queue";
import { getPipeline, removePipeline } from "./api/tasks";

export class TaskEngine {
  #bus: PipelineEventBus<CoreEventMap>;
  #queue: TaskQueue;
  #running = false;
  #timeoutMs: number;

  constructor(params: {
    bus: PipelineEventBus<CoreEventMap>;
    queue: TaskQueue;
    timeoutMs?: number;
  }) {
    this.#bus = params.bus;
    this.#queue = params.queue;
    this.#timeoutMs = params.timeoutMs ?? 120_000;

    this.#bus.on(BusEvents.Task.Enqueued, () => this.#onTaskEnqueued());
  }

  start(): void {
    this.#running = true;
    this.#onTaskEnqueued();
  }

  stop(): void {
    this.#running = false;
  }

  async drain(params: { timeoutMs?: number }): Promise<void> {
    const deadline = Date.now() + (params.timeoutMs ?? 30_000);
    this.stop();
    while (this.#queue.processing > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  #onTaskEnqueued(): void {
    if (!this.#running) return;
    Promise.resolve().then(() => this.#processNext());
  }

  async #processNext(): Promise<void> {
    if (!this.#running) return;

    const task = this.#queue.dequeue();
    if (!task) return;

    this.#queue.markProcessing(task.id);
    task.state = TaskState.PROCESSING;
    task.updatedAt = Date.now();

    this.#bus.emit(BusEvents.Task.Activated, { task });

    try {
      const result = await this.#executeTask(task);

      this.#queue.markDone(task.id);
      task.state = TaskState.COMPLETED;
      task.updatedAt = Date.now();

      this.#bus.emit(BusEvents.Task.Completed, { task, result });
      this.#bus.emit(BusEvents.Pipeline.Result, { task, result });
    } catch (error) {
      this.#queue.markDone(task.id);
      task.state = TaskState.FAILED;
      task.updatedAt = Date.now();

      this.#bus.emit(BusEvents.Task.Failed, { task, error });
    } finally {
      removePipeline(task.id);
    }

    this.#onTaskEnqueued();
  }

  async #executeTask(task: TaskItem): Promise<any> {
    const pipeline = getPipeline(task.id);
    if (!pipeline) return { type: "complete", task };

    let current: any = { mode: "initial", task };

    for (const element of pipeline.elements) {
      try {
        current = await element.process(current);
      } catch (err) {
        this.#bus.emit(BusEvents.Task.Failed as any, { task, error: err });
        throw err;
      }
    }

    return current;
  }
}
