import { describe, test, expect, beforeEach } from "bun:test";
import { PipelineBuilder, pipeline } from "./builder";
import { createElementRegistry } from "./registry";
import type { ElementRegistry } from "./registry";
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
  let registry: ElementRegistry;

  beforeEach(() => {
    registry = createElementRegistry();
    bus = new PipelineEventBus<PipelineEventMap>();
    registry.register(names.src, Src as any);
    registry.register(names.trans, Trans as any);
    registry.register(names.bound, Bound as any);
    registry.register(names.snk, Snk as any);
  });

  test("builds a valid pipeline", () => {
    const p = pipeline("test", registry)
      .source(names.src)
      .transform(names.trans)
      .boundary(names.bound)
      .sink(names.snk)
      .build(bus);
    expect(p.name).toBe("test");
    expect(p.elements.length).toBe(4);
  });

  test("resolves elements from the injected registry only", () => {
    const other = createElementRegistry();
    other.register(names.src, Src as any);

    expect(() => pipeline("missing", other)
      .source(names.src)
      .sink(names.snk)
      .build(bus)).toThrow(`Element "${names.snk}" not found`);
    expect(() => new PipelineBuilder("missing", other)
      .source(names.src)
      .transform(names.trans)
      .sink(names.snk)
      .build(bus)).toThrow(`Element "${names.trans}" not found`);
  });

  test("throws when pipeline starts without source", () => {
    expect(() => pipeline("bad", registry).transform(names.trans).sink(names.snk).build(bus)).toThrow(
      "must start with source",
    );
  });

  test("throws when pipeline does not end with sink", () => {
    expect(() => pipeline("bad", registry).source(names.src).build(bus)).toThrow("must end with sink");
  });

  test("throws on duplicate element names", () => {
    expect(() =>
      pipeline("bad", registry).source(names.src).source(names.src).sink(names.snk).build(bus),
    ).toThrow("duplicate");
  });

  test("throws on empty pipeline", () => {
    expect(() => pipeline("empty", registry).build(bus)).toThrow("at least one element");
  });

  test("minimal valid pipeline: source + sink", () => {
    const p = pipeline("minimal", registry).source(names.src).sink(names.snk).build(bus);
    expect(p.elements.length).toBe(2);
  });
});
