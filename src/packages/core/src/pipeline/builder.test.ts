import { describe, test, expect, beforeEach } from "bun:test";
import { PipelineBuilder, pipeline } from "./builder";
import { registerElement, clearRegistry } from "./registry";
import { BaseElement, PipelineEventBus } from "@atom-neo/shared";
import type { PipelineEventMap } from "@atom-neo/shared";

class Src extends BaseElement<any, any> {
  constructor(params: any) { super({ name: params.name, kind: "source", bus: params.bus }); }
  async doProcess(input: any): Promise<any> { return { mode: "next", ...input }; }
}
class Trans extends BaseElement<any, any> {
  constructor(params: any) { super({ name: params.name, kind: "transform", bus: params.bus }); }
  async doProcess(input: any): Promise<any> { return input; }
}
class Bound extends BaseElement<any, any> {
  constructor(params: any) { super({ name: params.name, kind: "boundary", bus: params.bus }); }
  async doProcess(input: any): Promise<any> { return { mode: "ready_to_finalize", ...input }; }
}
class Snk extends BaseElement<any, any> {
  constructor(params: any) { super({ name: params.name, kind: "sink", bus: params.bus }); }
  async doProcess(input: any): Promise<any> { return { type: "complete" }; }
}

const names = { src: "bld-src", trans: "bld-trans", bound: "bld-bound", snk: "bld-snk" };

describe("PipelineBuilder", () => {
  let bus: PipelineEventBus<PipelineEventMap>;

  beforeEach(() => {
    clearRegistry();
    bus = new PipelineEventBus<PipelineEventMap>();
    registerElement(names.src, Src as any);
    registerElement(names.trans, Trans as any);
    registerElement(names.bound, Bound as any);
    registerElement(names.snk, Snk as any);
  });

  test("builds a valid pipeline", () => {
    const p = pipeline("test")
      .source(names.src)
      .transform(names.trans)
      .boundary(names.bound)
      .sink(names.snk)
      .build(bus);
    expect(p.name).toBe("test");
    expect(p.elements.length).toBe(4);
  });

  test("throws when pipeline starts without source", () => {
    expect(() => pipeline("bad").transform(names.trans).sink(names.snk).build(bus)).toThrow(
      "must start with source",
    );
  });

  test("throws when pipeline does not end with sink", () => {
    expect(() => pipeline("bad").source(names.src).build(bus)).toThrow("must end with sink");
  });

  test("throws on duplicate element names", () => {
    expect(() =>
      pipeline("bad").source(names.src).source(names.src).sink(names.snk).build(bus),
    ).toThrow("duplicate");
  });

  test("throws on empty pipeline", () => {
    expect(() => pipeline("empty").build(bus)).toThrow("at least one element");
  });

  test("minimal valid pipeline: source + sink", () => {
    const p = pipeline("minimal").source(names.src).sink(names.snk).build(bus);
    expect(p.elements.length).toBe(2);
  });
});
