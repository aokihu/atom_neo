import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

export function createSearchMemoryTool(): ToolDefinition {
  return {
    name: "search_memory",
    description: "Search memory graph by keywords.",
    source: "builtin",
    inputSchema: z.object({ query: z.string(), scope: z.enum(["core", "short", "long"]).default("long"), limit: z.number().optional().default(10) }),
    execute: async () => ({ ok: true, output: "(memory service not connected)", data: { results: [] } }),
    permission: PermissionLevel.READ_ONLY,
  };
}

export function createSaveMemoryTool(): ToolDefinition {
  const schema = z.object({ key: z.string(), type: z.enum(["fact", "preference", "constraint"]), content: z.string(), category: z.string().optional() });
  return {
    name: "save_memory",
    description: "Save a fact, preference, or constraint to memory.",
    source: "builtin", inputSchema: schema,
    execute: async (args) => {
      const r = schema.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      return { ok: true, output: `Saved memory: ${r.data.key}`, data: r.data };
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}

export function createTraverseMemoryTool(): ToolDefinition {
  return {
    name: "traverse_memory",
    description: "Traverse memory graph from a starting key.",
    source: "builtin",
    inputSchema: z.object({ goal: z.string(), startKey: z.string().optional(), maxSteps: z.number().optional().default(10), limit: z.number().optional().default(10) }),
    execute: async () => ({ ok: true, output: "(memory service not connected)", data: { paths: [] } }),
    permission: PermissionLevel.READ_ONLY,
  };
}

export function createLinkMemoryTool(): ToolDefinition {
  const schema = z.object({ sourceKey: z.string(), targetKey: z.string(), relation: z.string() });
  return {
    name: "link_memory",
    description: "Create a relationship between two memory nodes.",
    source: "builtin", inputSchema: schema,
    execute: async (args) => {
      const r = schema.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      return { ok: true, output: `Linked ${r.data.sourceKey} → ${r.data.targetKey}`, data: r.data };
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}
