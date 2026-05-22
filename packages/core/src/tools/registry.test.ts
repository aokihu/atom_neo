import { describe, test, expect } from "bun:test";
import { ToolRegistry } from "./registry";
import { PermissionLevel } from "@atom-neo/shared";
import type { ToolDefinition } from "@atom-neo/shared";
import { z } from "zod";

const mockTool: ToolDefinition = {
  name: "mock",
  description: "A test tool",
  source: "builtin",
  inputSchema: z.object({ val: z.string() }),
  execute: async () => ({ ok: true, output: "done" }),
};

describe("ToolRegistry", () => {
  test("registers and retrieves a tool", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    expect(reg.get("mock")).toBe(mockTool);
  });

  test("throws on duplicate registration", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    expect(() => reg.register(mockTool)).toThrow("already registered");
  });

  test("throws when tool not found", () => {
    const reg = new ToolRegistry();
    expect(() => reg.get("missing")).toThrow("not found");
  });

  test("unregisters a tool", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    expect(reg.unregister("mock")).toBe(true);
    expect(reg.has("mock")).toBe(false);
  });

  test("returns all registered tools", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    reg.register({ ...mockTool, name: "mock2", source: "plugin" as const });
    expect(reg.getAll().length).toBe(2);
  });
});
