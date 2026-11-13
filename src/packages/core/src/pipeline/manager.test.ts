import { describe, test, expect, beforeEach } from "bun:test";
import { PipelineManager } from "./manager";
import { createElementRegistry } from "./registry";
import type { ElementRegistry } from "./registry";
import { pipeline } from "./builder";
import { BaseElement, PipelineEventBus } from "@atom-neo/shared";
import type { PipelineEventMap } from "@atom-neo/shared";

class Msrc extends BaseElement<any, any> {
  constructor(params: any) { super({ name: params.name, kind: "source", bus: params.bus }); }
  async doProcess(input: any): Promise<any> { return input; }
}
class Msnk extends BaseElement<any, any> {
  constructor(params: any) { super({ name: params.name, kind: "sink", bus: params.bus }); }
  async doProcess(input: any): Promise<any> { return { type: "complete" }; }
}

const names = { src: "mgr-src", snk: "mgr-snk" };

describe("PipelineManager", () => {
  let mgr: PipelineManager;
  let bus: PipelineEventBus<PipelineEventMap>;
  let registry: ElementRegistry;

  beforeEach(() => {
    registry = createElementRegistry();
    mgr = new PipelineManager();
    bus = new PipelineEventBus<PipelineEventMap>();
    registry.register(names.src, Msrc as any);
    registry.register(names.snk, Msnk as any);
  });

  test("registers and retrieves a pipeline", () => {
    mgr.register("test", () => pipeline("test", registry).source(names.src).sink(names.snk).build(bus));
    const p = mgr.get("test");
    expect(p.name).toBe("test");
  });

  test("throws when pipeline not found", () => {
    expect(() => mgr.get("missing")).toThrow("not found");
  });

  test("throws on duplicate registration", () => {
    const fn = () => pipeline("dup", registry).source(names.src).sink(names.snk).build(bus);
    mgr.register("dup", fn);
    expect(() => mgr.register("dup", fn)).toThrow("already registered");
  });

  test("caches pipeline on first get", () => {
    let calls = 0;
    mgr.register("p", () => {
      calls++;
      return pipeline("p", registry).source(names.src).sink(names.snk).build(bus);
    });
    mgr.get("p");
    mgr.get("p");
    expect(calls).toBe(1);
  });

  test("reload rebuilds pipeline", () => {
    let calls = 0;
    mgr.register("p", () => {
      calls++;
      return pipeline("p", registry).source(names.src).sink(names.snk).build(bus);
    });
    mgr.get("p");
    mgr.reload("p");
    expect(calls).toBe(2);
  });

  test("lists registered pipeline names", () => {
    mgr.register("a", () => pipeline("a", registry).source(names.src).sink(names.snk).build(bus));
    mgr.register("b", () => pipeline("b", registry).source(names.src).sink(names.snk).build(bus));
    expect(mgr.list()).toContain("a");
    expect(mgr.list()).toContain("b");
  });
});
