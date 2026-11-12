import { TaskState, BusEvents } from "@atom-neo/shared";
import type { TaskItem, CoreEventMap } from "@atom-neo/shared";
import type { PipelineEventBus } from "@atom-neo/shared";
import type { TaskQueue, TaskChainCancellation } from "./task-queue";
import type { PipelineInstanceStore } from "./pipeline/instance-store";
import { TaskCancelledError, TaskRunner, throwIfCancelled } from "./task/task-runner";
import type { PipelineBuilder } from "./task/task-runner";
import { Wakeup } from "./task/wakeup";

export { TaskCancelledError } from "./task/task-runner";

export class TaskEngine {
  #bus: PipelineEventBus<CoreEventMap>;
  #queue: TaskQueue;
  #running = false;
  #wake = new Wakeup();
  #epoch = 0;
  #loopPromise?: Promise<void>;
  #pipelineStore: PipelineInstanceStore;
  #taskRunner: TaskRunner;
  #abortControllers = new Map<string, AbortController>();
  #discardChain?: (chainId: string, sessionId: string) => void;

  constructor(params: {
    bus: PipelineEventBus<CoreEventMap>;
    queue: TaskQueue;
    pipelineStore: PipelineInstanceStore;
    pipelineBuilders?: Record<string, PipelineBuilder>;
    discardChain?: (chainId: string, sessionId: string) => void;
  }) {
    this.#bus = params.bus;
    this.#queue = params.queue;
    this.#pipelineStore = params.pipelineStore;
    this.#taskRunner = new TaskRunner({
      pipelineStore: params.pipelineStore,
      pipelineBuilders: params.pipelineBuilders,
    });
    this.#discardChain = params.discardChain;

    this.#bus.on(BusEvents.Task.Enqueued, () => this.#onTaskEnqueued());
  }

  start(): void {
    if (this.#running) {
      this.#wake.notify();
      return;
    }
    this.#running = true;
    const epoch = ++this.#epoch;
    const previous = this.#loopPromise;
    this.#loopPromise = (async () => {
      if (previous) await previous.catch(() => {});
      await this.#runLoop(epoch);
    })();
    this.#wake.notify();
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    this.#wake.notify();
  }

  cancel(taskId: string, sessionId: string): boolean {
    const cancellation = this.#queue.cancelChain(taskId, sessionId);
    if (!cancellation) return false;

    const error = new TaskCancelledError();
    this.#discardChain?.(cancellation.chainId, sessionId);
    this.#applyCancellation(cancellation, error);
    return true;
  }

  async drain(params: { timeoutMs?: number }): Promise<boolean> {
    const deadline = Date.now() + (params.timeoutMs ?? 30_000);
    this.#onTaskEnqueued();
    while (this.#queue.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const drained = this.#queue.size === 0;
    if (drained) this.stop();
    return drained;
  }

  #onTaskEnqueued(): void {
    if (this.#running) this.#wake.notify();
  }

  async #runLoop(epoch: number): Promise<void> {
    while (this.#running && epoch === this.#epoch) {
      const task = this.#queue.dequeue();
      if (!task) {
        await this.#wake.wait();
        continue;
      }
      await this.#processTask(task);
    }
  }

  async #processTask(task: TaskItem): Promise<void> {
    const abortController = new AbortController();
    this.#abortControllers.set(task.id, abortController);
    this.#queue.markProcessing(task);
    task.state = TaskState.PROCESSING;
    task.updatedAt = Date.now();

    this.#bus.emit(BusEvents.Task.Activated, { task });

    try {
      const result = await this.#taskRunner.run(task, abortController.signal);
      throwIfCancelled(abortController.signal);

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
      this.#pipelineStore.delete(task.id);
    }
  }

  #applyCancellation(cancellation: TaskChainCancellation, error: TaskCancelledError): void {
    for (const task of cancellation.queued) {
      task.state = TaskState.CANCELLED;
      task.updatedAt = Date.now();
      this.#queue.storeResult(task.id, {
        taskId: task.id,
        state: TaskState.CANCELLED,
        error: error.message,
      });
      this.#pipelineStore.delete(task.id);
      this.#bus.emit(BusEvents.Task.Failed, { task, error });
    }

    for (const task of cancellation.processing) {
      this.#abortControllers.get(task.id)?.abort(error);
    }
  }
}
