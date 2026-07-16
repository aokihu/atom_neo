import { describe, test, expect } from "bun:test";
import { registerBuiltinTools, createAllTools } from "./bootstrap";
import { ToolRegistry } from "./registry";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { ContextService } from "../context/context-service";
import { SessionPersistenceService } from "../session/persistence-service";

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

  test("registers session history tools when persistence is available", () => {
    const contextService = new ContextService(new PipelineEventBus<FullEventMap>(), { sweepIntervalMs: 0 });
    const persistence = new SessionPersistenceService(sandbox, contextService);
    const names = createAllTools(sandbox, undefined, [], persistence).map(tool => tool.name);

    expect(names).toContain("search_history");
    expect(names).toContain("read_history");
  });
});
