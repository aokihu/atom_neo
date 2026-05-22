import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

const searchSchema = z.object({
  query: z.string().describe("Search keywords or question"),
  scope: z.enum(["core", "short", "long"]).default("long"),
  limit: z.number().optional().default(10),
});

export const searchMemoryTool: ToolDefinition = {
  name: "search_memory",
  description:
    "Search memory graph by keywords. Returns matching facts, preferences, and constraints.",
  source: "builtin",
  inputSchema: searchSchema,
  execute: async () => {
    return { ok: true, output: "(memory service not connected)", data: { results: [] } };
  },
  permission: PermissionLevel.READ_ONLY,
};

const saveSchema = z.object({
  key: z.string().describe("Unique identifier for this memory"),
  type: z.enum(["fact", "preference", "constraint"]).describe("Memory type"),
  content: z.string().describe("The content to remember"),
  category: z.string().optional().describe("Domain category"),
});

export const saveMemoryTool: ToolDefinition = {
  name: "save_memory",
  description: "Save a fact, preference, or constraint to memory.",
  source: "builtin",
  inputSchema: saveSchema,
  execute: async (args) => {
    const r = saveSchema.safeParse(args);
    if (!r.success) return { ok: false, output: "", error: r.error.message };
    return { ok: true, output: `Saved memory: ${r.data.key}`, data: r.data };
  },
  permission: PermissionLevel.FILE_WRITE,
};

const traverseSchema = z.object({
  goal: z.string().describe("What you are looking for"),
  startKey: z.string().optional().describe("Entry point key"),
  maxSteps: z.number().optional().default(10),
  limit: z.number().optional().default(10),
});

export const traverseMemoryTool: ToolDefinition = {
  name: "traverse_memory",
  description:
    "Traverse the memory graph from a starting key or via FTS5 seed nodes.",
  source: "builtin",
  inputSchema: traverseSchema,
  execute: async () => {
    return { ok: true, output: "(memory service not connected)", data: { paths: [] } };
  },
  permission: PermissionLevel.READ_ONLY,
};

const linkSchema = z.object({
  sourceKey: z.string().describe("Source node key"),
  targetKey: z.string().describe("Target node key"),
  relation: z.string().describe("Relationship type"),
});

export const linkMemoryTool: ToolDefinition = {
  name: "link_memory",
  description: "Create a relationship between two memory nodes.",
  source: "builtin",
  inputSchema: linkSchema,
  execute: async (args) => {
    const r = linkSchema.safeParse(args);
    if (!r.success) return { ok: false, output: "", error: r.error.message };
    return {
      ok: true,
      output: `Linked ${r.data.sourceKey} → ${r.data.targetKey}`,
      data: r.data,
    };
  },
  permission: PermissionLevel.FILE_WRITE,
};
