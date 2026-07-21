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
  test("defers a visible webfetch with a successful guidance result", async () => {
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
    expect(result).toEqual({
      ok: true,
      output: "Call search_memory, then retry webfetch.",
      data: { status: "deferred", reason: "memory_search_required" },
    });
  });

  test("executes the tool after the dynamic policy allows it", async () => {
    const guarded = createToolGuard(createTool(async () => ({ ok: true, output: "fetched" })), "/tmp/sandbox", []);

    const result = await guarded.execute({ url: "https://example.com" }, {
      guardState: { webfetch: { allowed: true, reason: "capability_discovery_complete" } },
    });

    expect(result).toEqual({ ok: true, output: "fetched" });
  });
});
