import { describe, test, expect } from "bun:test";
import { registerBuiltinTools, createAllTools } from "./bootstrap";
import { ToolRegistry } from "./registry";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const sandbox = mkdtempSync(resolve(tmpdir(), "atom-bootstrap-"));

describe("registerBuiltinTools", () => {
  test("registers all builtin tools", () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg, sandbox);
    expect(reg.getAll().length).toBeGreaterThan(0);
  });

  test("all tools have unique names", () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg, sandbox);
    const names = reg.getAll().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
