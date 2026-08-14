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

describe("createToolGuard", () => {
  test("does not add a business precondition to webfetch", async () => {
    let executed = false;
    const guarded = createToolGuard(createTool(async () => {
      executed = true;
      return { content: "fetched", metadata: { ok: true, effect: "evidence" } };
    }), "/tmp/sandbox", []);

    const result = await guarded.execute({ url: "https://example.com" }, {});

    expect(executed).toBe(true);
    expect(result).toEqual({
      content: "fetched",
      metadata: { ok: true, effect: "evidence" },
    });
  });

  test("marks framework path rejections as Guard failures", async () => {
    const guarded = createToolGuard({
      ...createTool(async () => ({ metadata: { ok: true, effect: "none" } })),
      name: "read",
    }, "/tmp/sandbox", []);

    const result = await guarded.execute({ filepath: "/outside/file" }, {});

    expect(result.metadata).toEqual({
      ok: false,
      effect: "none",
      error: "Path is outside sandbox",
      errorSource: "guard",
    });
  });
});
