import { describe, expect, test } from "bun:test";
import { createElementRegistry } from "@core/pipeline/registry";
import { registerSharedElements } from ".";

describe("registerSharedElements", () => {
  test("registers elements into the provided registry and surfaces duplicate registration", () => {
    const registry = createElementRegistry();
    registerSharedElements(registry);
    expect(registry.names()).toEqual(["jev-decision", "token-ratio"]);
    expect(() => registerSharedElements(registry)).toThrow('Element "jev-decision" already registered');
  });

  test("keeps separate registries independent", () => {
    const first = createElementRegistry();
    const second = createElementRegistry();
    registerSharedElements(first);
    registerSharedElements(second);
    expect(first.names()).toEqual(second.names());
    expect(first).not.toBe(second);
  });
});
