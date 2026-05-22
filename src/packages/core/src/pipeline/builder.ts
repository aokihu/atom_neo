import type { BaseElement, PipelineEventBus, PipelineEventMap } from "@atom-neo/shared";
import type { PipelineElementKind } from "@atom-neo/shared";
import { resolveElement } from "./registry";

type ElementDef = {
  name: string;
  kind: PipelineElementKind;
  deps: Record<string, unknown>;
};

export type Pipeline = {
  name: string;
  elements: BaseElement[];
};

export class PipelineBuilder {
  #name: string;
  #elements: ElementDef[] = [];

  constructor(name: string) {
    this.#name = name;
  }

  source(elementName: string, deps: Record<string, unknown> = {}): this {
    this.#elements.push({ name: elementName, kind: "source", deps });
    return this;
  }

  transform(elementName: string, deps: Record<string, unknown> = {}): this {
    this.#elements.push({ name: elementName, kind: "transform", deps });
    return this;
  }

  boundary(elementName: string, deps: Record<string, unknown> = {}): this {
    this.#elements.push({ name: elementName, kind: "boundary", deps });
    return this;
  }

  sink(elementName: string, deps: Record<string, unknown> = {}): this {
    this.#elements.push({ name: elementName, kind: "sink", deps });
    return this;
  }

  build(bus: PipelineEventBus<PipelineEventMap>): Pipeline {
    if (this.#elements.length === 0) {
      throw new Error(`Pipeline "${this.#name}": must have at least one element`);
    }

    const first = this.#elements[0];
    if (first.kind !== "source") {
      throw new Error(`Pipeline "${this.#name}": must start with source, got ${first.kind}`);
    }

    const last = this.#elements[this.#elements.length - 1];
    if (last.kind !== "sink") {
      throw new Error(`Pipeline "${this.#name}": must end with sink, got ${last.kind}`);
    }

    const names = new Set<string>();
    const elements: BaseElement[] = [];

    for (const def of this.#elements) {
      if (names.has(def.name)) {
        throw new Error(`Pipeline "${this.#name}": duplicate element "${def.name}"`);
      }
      names.add(def.name);

      const Ctor = resolveElement(def.name);
      const instance = new Ctor({ ...def.deps, bus, name: def.name, kind: def.kind });
      elements.push(instance);
    }

    return { name: this.#name, elements };
  }
}

export function pipeline(name: string): PipelineBuilder {
  return new PipelineBuilder(name);
}
