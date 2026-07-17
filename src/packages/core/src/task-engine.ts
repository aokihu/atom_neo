import { TaskState, BusEvents } from "@atom-neo/shared";
import type { TaskItem, CoreEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import type { TaskQueue } from "./task-queue";
import { getPipeline, removePipeline, setPipeline } from "./api/tasks";
import type { Pipeline } from "./pipeline/builder";

type PipelineBuilder = (task: TaskItem) => Pipeline | undefined;

export class TaskCancelledError extends Error {
  readonly code = "PIPELINE_ABORTED";

  constructor() {
    super("Task cancelled by user");
    this.name = "TaskCancelledError";
  }
}

export class TaskEngine {
  #bus: PipelineEventBus<CoreEventMap>;
  #queue: TaskQueue;
  #running = false;
  #processing = false;
  #timeoutMs: number;
  #pipelineBuilders: Record<string, PipelineBuilder>;
  #abortControllers = new Map<string, AbortController>();
  #discardChain?: (chainId: string, sessionId: string) => void;

  constructor(params: {
    bus: PipelineEventBus<CoreEventMap>;
    queue: TaskQueue;
    pipelineBuilders?: Record<string, PipelineBuilder>;
    timeoutMs?: number;
    discardChain?: (chainId: string, sessionId: string) => void;
  }) {
    this.#bus = params.bus;
    this.#queue = params.queue;
    this.#pipelineBuilders = params.pipelineBuilders ?? {};
    this.#timeoutMs = params.timeoutMs ?? 120_000;
    this.#discardChain = params.discardChain;

    this.#bus.on(BusEvents.Task.Enqueued, () => this.#onTaskEnqueued());
  }

  start(): void {
    this.#running = true;
    this.#onTaskEnqueued();
  }

  stop(): void {
    this.#running = false;
  }

  cancel(taskId: string, sessionId: string): boolean {
    const cancellation = this.#queue.cancelChain(taskId, sessionId);
    if (!cancellation) return false;

    const error = new TaskCancelledError();
    this.#discardChain?.(cancellation.chainId, sessionId);

    for (const task of cancellation.queued) {
      task.state = TaskState.CANCELLED;
      task.updatedAt = Date.now();
      this.#queue.storeResult(task.id, {
        taskId: task.id,
        state: TaskState.CANCELLED,
        error: error.message,
      });
      removePipeline(task.id);
      this.#bus.emit(BusEvents.Task.Failed, { task, error });
    }

    for (const task of cancellation.processing) {
      this.#abortControllers.get(task.id)?.abort(error);
    }

    return true;
  }

  async drain(params: { timeoutMs?: number }): Promise<boolean> {
    const deadline = Date.now() + (params.timeoutMs ?? 30_000);
    this.#onTaskEnqueued();
    while (this.#queue.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const drained = this.#queue.size === 0;
    if (drained) this.stop();
    return drained;
  }

  #onTaskEnqueued(): void {
    if (!this.#running || this.#processing || this.#queue.size === 0) return;
    this.#processing = true;
    Promise.resolve()
      .then(() => this.#processNext())
      .finally(() => {
        this.#processing = false;
        this.#onTaskEnqueued();
      });
  }

  async #processNext(): Promise<void> {
    if (!this.#running) return;

    const task = this.#queue.dequeue();
    if (!task) return;

    const abortController = new AbortController();
    this.#abortControllers.set(task.id, abortController);
    this.#queue.markProcessing(task);
    task.state = TaskState.PROCESSING;
    task.updatedAt = Date.now();

    this.#bus.emit(BusEvents.Task.Activated, { task });

    try {
      const result = await this.#executeTask(task, abortController.signal);
      this.#throwIfCancelled(abortController.signal);

      this.#queue.markDone(task.id);
      task.state = TaskState.COMPLETED;
      task.updatedAt = Date.now();

      this.#bus.emit(BusEvents.Task.Completed, { task, result });
      this.#bus.emit(BusEvents.Pipeline.Result, { task, result });
    } catch (error) {
      this.#queue.markDone(task.id);
      const cancelled = abortController.signal.aborted;
      task.state = cancelled ? TaskState.CANCELLED : TaskState.FAILED;
      task.updatedAt = Date.now();

      this.#bus.emit(BusEvents.Task.Failed, {
        task,
        error: cancelled ? abortController.signal.reason ?? new TaskCancelledError() : error,
      });
    } finally {
      this.#abortControllers.delete(task.id);
      removePipeline(task.id);
    }
  }

  async #executeTask(task: TaskItem, abortSignal: AbortSignal): Promise<any> {
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
      this.#throwIfCancelled(abortSignal);
      current.abortSignal = abortSignal;
      current = await element.process(current);
      this.#throwIfCancelled(abortSignal);
    }

    if (!current || typeof current !== "object") return current;
    const { abortSignal: _abortSignal, ...result } = current;
    return result;
  }

  #throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw signal.reason ?? new TaskCancelledError();
  }
}
