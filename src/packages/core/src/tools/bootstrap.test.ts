import { describe, test, expect } from "bun:test";
import { registerBuiltinTools, createAllTools, partitionTools } from "./bootstrap";
import { ToolRegistry } from "./registry";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const sandbox = mkdtempSync(resolve(tmpdir(), "atom-bootstrap-"));

describe("registerBuiltinTools", () => {
  test("registers all 12 builtin tools", () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg, sandbox);
    expect(reg.getAll().length).toBe(12);
  });

  test("all tools have unique names", () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg, sandbox);
    const names = reg.getAll().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("partitionTools", () => {
  test("splits into basic and advanced", () => {
    const all = createAllTools(sandbox);
    const { basic, advanced } = partitionTools(all);
    expect(basic.length).toBe(7);
    expect(advanced.length).toBe(5);
    expect(basic.every(t => ["read","write","ls","grep","tree","search_memory","traverse_memory"].includes(t.name))).toBe(true);
    expect(advanced.every(t => ["cp","mv","bash","save_memory","link_memory"].includes(t.name))).toBe(true);
  });
});
