import { describe, test, expect } from "bun:test";
import { registerBuiltinTools, createAllTools } from "./bootstrap";
import { ToolRegistry } from "./registry";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import type { NetworkServiceLike } from "@atom-neo/shared";
import { ContextService } from "../context/context-service";
import { SessionPersistenceService } from "../session/persistence-service";
import { BackgroundShellService } from "./builtin/shell";

const sandbox = mkdtempSync(resolve(tmpdir(), "atom-bootstrap-"));
const network: NetworkServiceLike = {
  webFetch: async () => ({ ok: true, code: "success", content: "ok" }),
};
const backgroundShell = new BackgroundShellService({ sandbox, onComplete: () => {} });

describe("registerBuiltinTools", () => {
  test("registers all builtin tools", () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg, { sandbox, network, backgroundShell });
    expect(reg.getAll().length).toBeGreaterThan(0);
  });

  test("all tools have unique names", () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg, { sandbox, network, backgroundShell });
    const names = reg.getAll().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("registers session history tools when persistence is available", () => {
    const contextService = new ContextService(new PipelineEventBus<FullEventMap>(), { sweepIntervalMs: 0 });
    const persistence = new SessionPersistenceService(sandbox, contextService);
    const names = createAllTools({ sandbox, network, whitelist: [], persistence, backgroundShell }).map(tool => tool.name);

    expect(names).toContain("search_history");
    expect(names).toContain("read_history");
    expect(names).toContain("request_tool_record");
    expect(names).toContain("request_tool_records");
    const tools = createAllTools({ sandbox, network, whitelist: [], persistence, backgroundShell });
    expect(tools.find(tool => tool.name === "request_tool_record")?.recordPolicy).toBe("exclude");
    expect(tools.find(tool => tool.name === "request_tool_records")?.recordPolicy).toBe("exclude");
  });

  test("opts only side-effect-free query tools into same-name batches", () => {
    const tools = createAllTools({ sandbox, network, whitelist: [], backgroundShell });
    const byName = new Map(tools.map(tool => [tool.name, tool]));

    for (const name of ["search_memory", "read_memory", "grep", "websearch"]) {
      expect(byName.get(name)?.allowSameToolBatch).toBe(true);
    }
    for (const name of ["write", "intent", "todowrite", "webfetch", "save_memory"]) {
      expect(byName.get(name)?.allowSameToolBatch).not.toBe(true);
    }
  });

  test("registers Shell tools without the legacy bash name", () => {
    const names = createAllTools({ sandbox, network, whitelist: [], backgroundShell }).map(tool => tool.name);

    expect(names).toContain("shell");
    expect(names).toContain("background_shell");
    expect(names).not.toContain("bash");
  });
});
