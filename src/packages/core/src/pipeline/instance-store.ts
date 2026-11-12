import type { Pipeline } from "./builder";

/** Per-Core cache of built pipeline instances, keyed by task id. No TTL/eviction. */
export class PipelineInstanceStore {
  #pipelines = new Map<string, Pipeline>();

  get(taskId: string): Pipeline | undefined {
    return this.#pipelines.get(taskId);
  }

  set(taskId: string, pipeline: Pipeline): void {
    this.#pipelines.set(taskId, pipeline);
  }

  delete(taskId: string): void {
    this.#pipelines.delete(taskId);
  }

  get size(): number {
    return this.#pipelines.size;
  }

  clear(): void {
    this.#pipelines.clear();
  }
}
