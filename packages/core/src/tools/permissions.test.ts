import { describe, test, expect } from "bun:test";
import { filterToolsByPermission } from "./permissions";
import { PermissionLevel } from "@atom-neo/shared";
import type { ToolDefinition } from "@atom-neo/shared";
import { z } from "zod";

function makeTool(name: string, perm?: PermissionLevel): ToolDefinition {
  return {
    name,
    description: "test",
    source: "builtin",
    inputSchema: z.object({}),
    execute: async () => ({ ok: true, output: "" }),
    permission: perm,
  };
}

describe("filterToolsByPermission", () => {
  test("includes tools within permission level", () => {
    const tools = [makeTool("a", PermissionLevel.READ_ONLY)];
    const result = filterToolsByPermission(tools, PermissionLevel.READ_ONLY);
    expect(result.length).toBe(1);
  });

  test("excludes tools above permission level", () => {
    const tools = [makeTool("a", PermissionLevel.FILE_WRITE)];
    const result = filterToolsByPermission(tools, PermissionLevel.READ_ONLY);
    expect(result.length).toBe(0);
  });

  test("defaults to READ_ONLY when no permission specified", () => {
    const tools = [makeTool("a")];
    const result = filterToolsByPermission(tools, PermissionLevel.READ_ONLY);
    expect(result.length).toBe(1);
  });
});
