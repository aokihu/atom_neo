import { afterEach, describe, expect, test } from "bun:test";
import { clearRegistry, getRegisteredNames } from "../../pipeline/registry";
import { registerSharedElements } from ".";

describe("registerSharedElements", () => {
  afterEach(clearRegistry);

  test("registers elements directly and surfaces duplicate registration", () => {
    clearRegistry();
    registerSharedElements();
    expect(getRegisteredNames()).toEqual(["jev-decision", "token-ratio"]);
    expect(() => registerSharedElements()).toThrow('Element "jev-decision" already registered');
  });
});
