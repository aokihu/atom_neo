import { describe, test, expect, beforeEach } from "bun:test";
import { registerElement, resolveElement, getRegisteredNames, clearRegistry } from "./registry";
import { BaseElement } from "@atom-neo/shared";

class RegEl extends BaseElement<any, any> {
  constructor(params: any) { super({ name: params.name, kind: "source", bus: params.bus }); }
  async doProcess(input: any) { return input; }
}

describe("element registry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  test("registers and resolves an element", () => {
    registerElement("reg-el", RegEl as any);
    expect(resolveElement("reg-el")).toBe(RegEl as any);
  });

  test("throws on duplicate registration", () => {
    registerElement("reg-dup", RegEl as any);
    expect(() => registerElement("reg-dup", RegEl as any)).toThrow("already registered");
  });

  test("throws when element not found", () => {
    expect(() => resolveElement("nonexistent-xyz")).toThrow("not found");
  });

  test("lists registered names", () => {
    registerElement("reg-a", RegEl as any);
    registerElement("reg-b", RegEl as any);
    expect(getRegisteredNames()).toContain("reg-a");
    expect(getRegisteredNames()).toContain("reg-b");
  });
});
