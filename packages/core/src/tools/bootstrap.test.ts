import { describe, test, expect } from "bun:test";
import { registerBuiltinTools } from "./bootstrap";
import { ToolRegistry } from "./registry";

describe("registerBuiltinTools", () => {
  test("registers all 12 builtin tools", () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    expect(reg.getAll().length).toBe(12);
  });

  test("all tools have unique names", () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const names = reg.getAll().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
