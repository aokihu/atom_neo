import type { TaskItem } from "@atom-neo/shared";
import type { Pipeline } from "../pipeline/builder";
import type { PipelineInstanceStore } from "../pipeline/instance-store";

export type PipelineBuilder = (task: TaskItem) => Pipeline | undefined;

export class TaskCancelledError extends Error {
  readonly code = "PIPELINE_ABORTED";

  constructor() {
    super("Task cancelled by user");
    this.name = "TaskCancelledError";
  }
}

export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new TaskCancelledError();
}

/**
 * Executes one task's pipeline without owning queue or lifecycle events.
 * Pipeline instances are cached per task through the injected store; every
 * element receives a new state object containing the current abort signal.
 */
export class TaskRunner {
  #pipelineStore: PipelineInstanceStore;
  #pipelineBuilders: Record<string, PipelineBuilder>;

  constructor(params: {
    pipelineStore: PipelineInstanceStore;
    pipelineBuilders?: Record<string, PipelineBuilder>;
  }) {
    this.#pipelineStore = params.pipelineStore;
    this.#pipelineBuilders = params.pipelineBuilders ?? {};
  }

  async run(task: TaskItem, abortSignal: AbortSignal): Promise<any> {
    let pipeline = this.#pipelineStore.get(task.id);

    if (!pipeline && task.pipeline) {
      const builder = this.#pipelineBuilders[task.pipeline];
      if (builder) {
        pipeline = builder(task);
        if (pipeline) this.#pipelineStore.set(task.id, pipeline);
      }
    }

    if (!pipeline) return { type: "complete", task };

    let current: any = { mode: "initial", task };

    for (const element of pipeline.elements) {
      throwIfCancelled(abortSignal);
      current = await element.process({ ...current, abortSignal });
      throwIfCancelled(abortSignal);
    }

    if (!current || typeof current !== "object") return current;
    const { abortSignal: _abortSignal, ...result } = current;
    return result;
  }
}
