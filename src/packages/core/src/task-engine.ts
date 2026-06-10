import { TaskState, BusEvents } from "@atom-neo/shared";
import type { TaskItem, CoreEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import type { TaskQueue } from "./task-queue";
import { getPipeline, removePipeline, setPipeline } from "./api/tasks";
import type { Pipeline } from "./pipeline/builder";
import { PipelineResultType } from "@atom-neo/shared";

type PipelineBuilder = (task: TaskItem) => Pipeline | undefined;

export class TaskEngine {
  #bus: PipelineEventBus<CoreEventMap>;
  #queue: TaskQueue;
  #running = false;
  #timeoutMs: number;
  #pipelineBuilders: Record<string, PipelineBuilder>;

  constructor(params: {
    bus: PipelineEventBus<CoreEventMap>;
    queue: TaskQueue;
    pipelineBuilders?: Record<string, PipelineBuilder>;
    timeoutMs?: number;
  }) {
    this.#bus = params.bus;
    this.#queue = params.queue;
    this.#pipelineBuilders = params.pipelineBuilders ?? {};
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

      if (result.type === PipelineResultType.Retry) {
        this.#queue.reEnqueue(task);
        task.state = TaskState.PENDING;
        task.updatedAt = Date.now();
        this.#bus.emit(BusEvents.Pipeline.Result as any, { task, result });
        this.#onTaskEnqueued();
        return;
      }

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
    let pipeline = getPipeline(task.id);

    if (!pipeline && task.pipeline) {
      const builder = this.#pipelineBuilders[task.pipeline];
      if (builder) {
        pipeline = builder(task);
        if (pipeline) setPipeline(task.id, pipeline);
      }
    }

    if (!pipeline) return { type: "complete", task };

    let current: any = { mode: "initial", task };

    for (const element of pipeline.elements) {
      try {
        current = await element.process(current);
      } catch (err) {
        throw err;
      }
    }

    return current;
  }
}
