import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

const searchMemoryInputSchema = z.object({
  query: z.string().describe("One or more broad concepts, synonyms, domain terms, or Skill names; avoid dates and freshness words"),
  limit: z.number().optional().default(3),
});

const forgetMemoryInputSchema = z.object({
  id: z.string()
    .regex(/^[a-fA-F0-9]+$/, "Memory ID must be a full or short hexadecimal ID")
    .describe("Full or short hexadecimal ID from <Memory id=\"...\">")
});

export function createSearchMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "search_memory",
    description: "Search memory with broad terms. Terms are matched independently against content and tags. If empty, retry until three non-overlapping query combinations fail before using webfetch.",
    source: "builtin",
    inputSchema: searchMemoryInputSchema,
    execute: async (args) => {
      if (!memory) return { ok: true, output: "(memory service not connected)", data: { results: [] } };
      const r = searchMemoryInputSchema.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      const nodes = await memory.search(r.data.query, r.data.limit);
      if (nodes.length === 0) return { ok: true, output: "No memories found. Retry with a broader query using different, non-overlapping keywords." };
      const output = nodes.map((n: any) => {
        const id = String(n.id).slice(0, 6);
        const tags = Array.isArray(n.tags) ? n.tags.join(",") : "";
        return `<Memory id="${id}" tags="${tags}">\n${n.content}\n</Memory>`;
      }).join("\n");
      return { ok: true, output, data: nodes };
    },
    permission: PermissionLevel.READ_ONLY,
  };
}

export function createSaveMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "save_memory",
    description: "Save to memory.",
    source: "builtin",
    inputSchema: z.object({ content: z.string(), tags: z.array(z.string()).optional().default([]) }),
    execute: async (args) => {
      if (!memory) return { ok: false, output: "", error: "memory service not connected" };
      const r = z.object({ content: z.string(), tags: z.array(z.string()).optional().default([]) }).safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      try {
        const id = memory.save(r.data.content, r.data.tags);
        return { ok: true, output: `Saved memory: ${id.slice(0, 8)}...`, data: { id } };
      } catch (err) {
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}

export function createTraverseMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "traverse_memory",
    description: "Traverse memory graph.",
    source: "builtin",
    inputSchema: z.object({ startId: z.string(), maxSteps: z.number().optional().default(4) }),
    execute: async (args) => {
      if (!memory) return { ok: true, output: "(memory service not connected)", data: { paths: [] } };
      const r = z.object({ startId: z.string(), maxSteps: z.number().optional().default(4) }).safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      const nodes = memory.traverse(r.data.startId, r.data.maxSteps);
      if (nodes.length === 0) return { ok: true, output: "No related memories found." };
      return { ok: true, output: nodes.map((n: any) => `- ${n.content.slice(0, 100)}`).join("\n"), data: nodes };
    },
    permission: PermissionLevel.READ_ONLY,
  };
}

export function createLinkMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "link_memory",
    description: "Link two memories.",
    source: "builtin",
    inputSchema: z.object({ source: z.string(), target: z.string(), relation: z.string() }),
    execute: async (args) => {
      if (!memory) return { ok: true, output: "(memory service not connected)", data: {} };
      const r = z.object({ source: z.string(), target: z.string(), relation: z.string() }).safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      memory.link(r.data.source, r.data.target, r.data.relation);
      return { ok: true, output: `Linked.` };
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}

export function createForgetMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "forget_memory",
    description: "Delete a memory by its full or short hexadecimal ID. If only content is known, call search_memory first and use the returned <Memory id>.",
    source: "builtin",
    inputSchema: forgetMemoryInputSchema,
    execute: async (args) => {
      if (!memory) return { ok: false, output: "", error: "memory service not connected" };
      const r = forgetMemoryInputSchema.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      try {
        const forgotten = memory.forget(r.data.id);
        return forgotten
          ? { ok: true, output: `Forgot memory: ${r.data.id}` }
          : { ok: false, output: "", error: `Memory not found: ${r.data.id}` };
      } catch (err) {
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}
