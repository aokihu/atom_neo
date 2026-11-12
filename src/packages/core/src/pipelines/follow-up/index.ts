import { pipeline } from "../../pipeline/builder";
import type { ElementRegistry } from "../../pipeline/registry";
import { BaseElement, PipelineEventBus } from "@atom-neo/shared";
import type { PipelineEventMap } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";

class FollowUpSourceElement extends BaseElement<any, any> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "source", bus: params.bus });
  }
  async doProcess(input: any) {
    if (input.mode !== "initial") return input;
    this.report(BusEvents.Element.Data, { step: "initial → asking" });
    return { mode: "asking", ...input };
  }
}

class FollowUpSinkElement extends BaseElement<any, any> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
  }
  async doProcess(input: any) {
    this.report(BusEvents.Element.Data, { step: "complete" });
    return { type: "complete", ...input };
  }
}

export function registerFollowUpElements(registry: ElementRegistry): void {
  registry.register("follow-up-source", FollowUpSourceElement);
  registry.register("follow-up-sink", FollowUpSinkElement);
}

export function followUpPipeline(elementRegistry: ElementRegistry) {
  return pipeline("follow-up", elementRegistry)
    .source("follow-up-source", {})
    .sink("follow-up-sink", {});
}
