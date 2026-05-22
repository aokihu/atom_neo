import type { Pipeline } from "./builder";

export class PipelineManager {
  #pipelines = new Map<string, Pipeline>();
  #builders = new Map<string, () => Pipeline>();

  register(name: string, builder: () => Pipeline): void {
    if (this.#builders.has(name)) {
      throw new Error(`Pipeline "${name}" already registered`);
    }
    this.#builders.set(name, builder);
  }

  get(name: string): Pipeline {
    if (!this.#pipelines.has(name)) {
      const builder = this.#builders.get(name);
      if (!builder) {
        throw new Error(
          `Pipeline "${name}" not found. Registered: [${[...this.#builders.keys()].join(", ")}]`,
        );
      }
      this.#pipelines.set(name, builder());
    }
    return this.#pipelines.get(name)!;
  }

  reload(name: string): Pipeline {
    const builder = this.#builders.get(name);
    if (!builder) throw new Error(`Pipeline "${name}" not found`);
    const pipeline = builder();
    this.#pipelines.set(name, pipeline);
    return pipeline;
  }

  list(): string[] {
    return [...this.#builders.keys()];
  }
}
