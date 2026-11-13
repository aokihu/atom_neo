import { describe, test, expect } from "bun:test";
import { ElementRegistry, createElementRegistry } from "./registry";
import { BaseElement } from "@atom-neo/shared";

class RegEl extends BaseElement<any, any> {
  constructor(params: any) { super({ name: params.name, kind: "source", bus: params.bus }); }
  async doProcess(input: any) { return input; }
}

describe("ElementRegistry", () => {
  test("registers and resolves an element", () => {
    const registry = createElementRegistry();
    registry.register("reg-el", RegEl as any);
    expect(registry.resolve("reg-el")).toBe(RegEl as any);
  });

  test("throws on duplicate registration", () => {
    const registry = createElementRegistry();
    registry.register("reg-dup", RegEl as any);
    expect(() => registry.register("reg-dup", RegEl as any)).toThrow('Element "reg-dup" already registered');
  });

  test("throws when element not found and lists registered names", () => {
    const registry = createElementRegistry();
    registry.register("reg-a", RegEl as any);
    expect(() => registry.resolve("nonexistent-xyz")).toThrow(
      'Element "nonexistent-xyz" not found. Registered: [reg-a]',
    );
  });

  test("lists registered names in registration order", () => {
    const registry = createElementRegistry();
    registry.register("reg-a", RegEl as any);
    registry.register("reg-b", RegEl as any);
    expect(registry.names()).toEqual(["reg-a", "reg-b"]);
  });

  test("clear removes every registration", () => {
    const registry = createElementRegistry();
    registry.register("reg-a", RegEl as any);
    registry.clear();
    expect(registry.names()).toEqual([]);
    expect(() => registry.resolve("reg-a")).toThrow("not found");
  });

  test("two registries can register the same names independently", () => {
    const first = createElementRegistry();
    const second = new ElementRegistry();
    first.register("shared-name", RegEl as any);
    second.register("shared-name", RegEl as any);

    expect(first).not.toBe(second);
    expect(first.resolve("shared-name")).toBe(RegEl as any);
    expect(second.resolve("shared-name")).toBe(RegEl as any);
    first.clear();
    expect(first.names()).toEqual([]);
    expect(second.names()).toEqual(["shared-name"]);
  });
});
