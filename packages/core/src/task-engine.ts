import { TaskState } from "@atom-neo/shared";
import type { TaskItem, CoreEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import type { TaskQueue } from "./task-queue";

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

    this.#bus.on("task.enqueued", () => this.#onTaskEnqueued());
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

    this.#bus.emit("task.activated", { task });

    try {
      const result = await this.#executeTask(task);

      this.#queue.markDone(task.id);
      task.state = TaskState.COMPLETED;
      task.updatedAt = Date.now();

      this.#bus.emit("task.completed", { task, result });
      this.#bus.emit("pipeline.result", { task, result });
    } catch (error) {
      this.#queue.markDone(task.id);
      task.state = TaskState.FAILED;
      task.updatedAt = Date.now();

      this.#bus.emit("task.failed", { task, error });
    }

    this.#onTaskEnqueued();
  }

  async #executeTask(_task: TaskItem): Promise<any> {
    // Pipeline execution is delegated to PipelineManager at runtime.
    // This method will be overridden or replaced with actual pipeline execution.
    // For now, signal that external pipeline execution should happen.
    await new Promise((r) => setTimeout(r, 0));
    return { type: "complete", task: _task };
  }
}
