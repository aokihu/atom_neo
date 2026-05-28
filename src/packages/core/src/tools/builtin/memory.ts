import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

export function createSearchMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "search_memory",
    description: "Search memory by keywords.",
    source: "builtin",
    inputSchema: z.object({ query: z.string(), limit: z.number().optional().default(3) }),
    execute: async (args) => {
      if (!memory) return { ok: true, output: "(memory service not connected)", data: { results: [] } };
      const r = z.object({ query: z.string(), limit: z.number().optional().default(3) }).safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      const nodes = await memory.search(r.data.query, r.data.limit);
      if (nodes.length === 0) return { ok: true, output: "No memories found." };
      return { ok: true, output: nodes.map((n: any) => `- ${n.content}`).join("\n"), data: nodes };
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
      if (!memory) return { ok: true, output: "(memory service not connected)", data: {} };
      const r = z.object({ content: z.string(), tags: z.array(z.string()).optional().default([]) }).safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      const id = memory.save(r.data.content, r.data.tags);
      return { ok: true, output: `Saved memory: ${id.slice(0, 8)}...`, data: { id } };
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}

export function createTraverseMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "traverse_memory",
    description: "Traverse memory graph.",
    source: "builtin",
    inputSchema: z.object({ startKey: z.string(), maxSteps: z.number().optional().default(4) }),
    execute: async (args) => {
      if (!memory) return { ok: true, output: "(memory service not connected)", data: { paths: [] } };
      const r = z.object({ startKey: z.string(), maxSteps: z.number().optional().default(4) }).safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      const nodes = memory.traverse(r.data.startKey, r.data.maxSteps);
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
