import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { createToolGuard } from "./guard";

function createTool(execute: ToolDefinition["execute"]): ToolDefinition {
  return {
    name: "webfetch",
    description: "test webfetch",
    source: "builtin",
    inputSchema: z.object({ url: z.string() }),
    execute,
  };
}

describe("createToolGuard dynamic policy", () => {
  test("blocks a visible tool before its original execute runs", async () => {
    let executed = false;
    const guarded = createToolGuard(createTool(async () => {
      executed = true;
      return { ok: true, output: "fetched" };
    }), "/tmp/sandbox", []);

    const result = await guarded.execute({ url: "https://example.com" }, {
      guardState: {
        webfetch: {
          allowed: false,
          reason: "memory_search_required",
          message: "Call search_memory, then retry webfetch.",
        },
      },
    });

    expect(executed).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("TOOL_GUARD_BLOCKED [memory_search_required]");
    expect(result.error).toContain("search_memory");
  });

  test("executes the tool after the dynamic policy allows it", async () => {
    const guarded = createToolGuard(createTool(async () => ({ ok: true, output: "fetched" })), "/tmp/sandbox", []);

    const result = await guarded.execute({ url: "https://example.com" }, {
      guardState: { webfetch: { allowed: true, reason: "capability_discovery_complete" } },
    });

    expect(result).toEqual({ ok: true, output: "fetched" });
  });
});
