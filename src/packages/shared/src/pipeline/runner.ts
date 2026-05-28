import type { PipelineResult, PipelineEventMap } from "../types/pipeline";
import type { PipelineDefinition } from "./types";
import type { BaseElement } from "./base-element";
import type { PipelineEventBus } from "./event-bus";
import { BusEvents } from "../constants/events";

export class PipelineRunner {
  #bus: PipelineEventBus<PipelineEventMap>;
  #elements: Map<string, BaseElement>;

  constructor(params: {
    bus: PipelineEventBus<PipelineEventMap>;
    elements: Map<string, BaseElement>;
  }) {
    this.#bus = params.bus;
    this.#elements = params.elements;
  }

  async run(
    input: any,
    def: PipelineDefinition,
  ): Promise<PipelineResult> {
    this.#bus.emit(BusEvents.Pipeline.ElementStarted, {
      pipelineName: def.name,
      elementName: def.name,
      elementKind: "sink",
    });

    let current = input;

    for (const elDef of def.elements) {
      const element = this.#elements.get(elDef.name);
      if (!element) {
        throw new Error(
          `Element "${elDef.name}" not found for pipeline "${def.name}"`,
        );
      }

      const start = performance.now();

      try {
        current = await element.process(current);
        this.#bus.emit(BusEvents.Pipeline.ElementFinished, {
          pipelineName: def.name,
          elementName: elDef.name,
          elementKind: elDef.kind,
          durationMs: performance.now() - start,
        });
      } catch (error) {
        this.#bus.emit(BusEvents.Pipeline.ElementFailed, {
          pipelineName: def.name,
          elementName: elDef.name,
          elementKind: elDef.kind,
          durationMs: performance.now() - start,
          error,
        });
        throw error;
      }
    }

    return current as PipelineResult;
  }
}
