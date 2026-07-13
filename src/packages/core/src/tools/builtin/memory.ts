import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel } from "@atom-neo/shared";

const searchMemoryInputSchema = z.object({
  query: z.string().describe("One or more broad concepts, synonyms, domain terms, or Skill names; avoid dates and freshness words"),
  limit: z.number().optional().default(3),
});

const memoryIdInputSchema = z.object({
  id: z.string()
    .regex(/^[a-fA-F0-9]+$/, "Memory ID must be a full or short hexadecimal ID")
    .describe("Full or short hexadecimal ID from <MemorySummary id=\"...\"> or <Memory id=\"...\">")
});

const memoryContextRetentionSchema = z.discriminatedUnion("retention", [
  z.object({
    retention: z.literal("pinned")
      .describe("Keep the memory for the current session"),
  }),
  z.object({
    retention: z.literal("ttl")
      .describe("Keep the memory until its time-to-live expires"),
    ttlSeconds: z.number().int().positive()
      .describe("Time-to-live in seconds; reading and injecting the same memory again renews it"),
  }),
]);

const readMemoryInputSchema = memoryIdInputSchema.extend({
  injectToContext: memoryContextRetentionSchema.optional()
    .describe("Optionally keep the full memory in Context: pinned for the session, or ttl for temporary topic context"),
});

const saveMemoryInputSchema = z.object({
  content: z.string(),
  summary: z.string().optional().describe("Concise retrieval preview; omit when content is already concise"),
  tags: z.array(z.string()).optional().default([]),
  baseWeight: z.number().min(0).max(100).optional(),
  kind: z.enum(["identity", "preference", "stable_fact", "decision", "workflow", "temporary_state", "realtime_data"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  pinned: z.boolean().optional(),
  supersedesId: z.string()
    .regex(/^[a-fA-F0-9]+$/, "Memory ID must be a full or short hexadecimal ID")
    .optional()
    .describe("Existing memory ID replaced by this new content"),
});

function formatMemorySummary(node: any): string {
  const id = String(node.id).slice(0, 6);
  const tags = Array.isArray(node.tags) ? node.tags.join(",") : "";
  return `<MemorySummary id="${id}" tags="${tags}">\n${node.summary}\n</MemorySummary>`;
}

function toMemorySummaryData(node: any): { id: string; summary: string; tags: string[] } {
  return { id: node.id, summary: node.summary, tags: node.tags };
}

function formatMemoryTraversalSummary(node: any): string {
  const id = String(node.id).slice(0, 6);
  const tags = Array.isArray(node.tags) ? node.tags.join(",") : "";
  const sourceId = node.sourceId ? ` sourceId="${String(node.sourceId).slice(0, 6)}"` : "";
  const relation = node.relation ? ` relation="${node.relation}"` : "";
  return `<MemorySummary id="${id}" tags="${tags}"${sourceId}${relation} depth="${node.depth}">\n${node.summary}\n</MemorySummary>`;
}

function toMemoryTraversalSummaryData(node: any) {
  return {
    ...toMemorySummaryData(node),
    sourceId: node.sourceId,
    relation: node.relation,
    depth: node.depth,
  };
}

export function createSearchMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "search_memory",
    description: "Search memory summaries with broad terms. Call read_memory with a returned ID only after confirming that a candidate is relevant.",
    source: "builtin",
    inputSchema: searchMemoryInputSchema,
    execute: async (args) => {
      if (!memory) return { ok: true, output: "(memory service not connected)", data: { results: [] } };
      const r = searchMemoryInputSchema.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      const nodes = await memory.search(r.data.query, r.data.limit);
      if (nodes.length === 0) return { ok: true, output: "No memories found. Retry with a broader query using different, non-overlapping keywords." };
      const output = nodes.map(formatMemorySummary).join("\n");
      return {
        ok: true,
        output,
        data: nodes.map(toMemorySummaryData),
      };
    },
    permission: PermissionLevel.READ_ONLY,
  };
}

export function createReadMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "read_memory",
    description: "Read the full content of a relevant memory. Optionally inject it into Context with pinned session retention or a temporary topic TTL.",
    source: "builtin",
    inputSchema: readMemoryInputSchema,
    execute: async (args) => {
      if (!memory) return { ok: false, output: "", error: "memory service not connected" };
      const result = readMemoryInputSchema.safeParse(args);
      if (!result.success) return { ok: false, output: "", error: result.error.message };
      const node = memory.getById(result.data.id);
      if (!node) return { ok: false, output: "", error: `Memory not found: ${result.data.id}` };
      memory.recordRead?.(node.id);
      const id = String(node.id).slice(0, 6);
      const tags = Array.isArray(node.tags) ? node.tags.join(",") : "";
      const output = `<Memory id="${id}" tags="${tags}">\n${node.content}\n</Memory>`;
      const retention = result.data.injectToContext;
      return {
        ok: true,
        output,
        data: node,
        ...(retention ? {
          contextInjection: {
            scope: retention.retention === "pinned" ? "session" as const : "topic" as const,
            entry: {
              key: `memory:${node.id}`,
              source: "memory",
              channel: "messages" as const,
              trust: "untrusted" as const,
              priority: 650,
              content: [{ role: "assistant", content: output }],
              ...(retention.retention === "pinned"
                ? { pinned: true }
                : { expiresAt: Date.now() + retention.ttlSeconds * 1000 }),
            },
          },
        } : {}),
      };
    },
    permission: PermissionLevel.READ_ONLY,
  };
}

export function createSaveMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "save_memory",
    description: "Save full memory content with an optional concise summary and tags. Set supersedesId when this content replaces an existing memory.",
    source: "builtin",
    inputSchema: saveMemoryInputSchema,
    execute: async (args) => {
      if (!memory) return { ok: false, output: "", error: "memory service not connected" };
      const r = saveMemoryInputSchema.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      try {
        const id = memory.save(r.data.content, r.data.tags, r.data.summary, {
          baseWeight: r.data.baseWeight,
          kind: r.data.kind,
          confidence: r.data.confidence,
          pinned: r.data.pinned,
          supersedesId: r.data.supersedesId,
        });
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
    description: "Traverse the memory graph and return related summaries. Use read_memory to retrieve selected full content.",
    source: "builtin",
    inputSchema: z.object({ startId: z.string(), maxSteps: z.number().optional().default(4) }),
    execute: async (args) => {
      if (!memory) return { ok: true, output: "(memory service not connected)", data: { paths: [] } };
      const r = z.object({ startId: z.string(), maxSteps: z.number().optional().default(4) }).safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      const nodes = memory.traverse(r.data.startId, r.data.maxSteps);
      if (nodes.length === 0) return { ok: true, output: "No related memories found." };
      return {
        ok: true,
        output: nodes.map(formatMemoryTraversalSummary).join("\n"),
        data: nodes.map(toMemoryTraversalSummaryData),
      };
    },
    permission: PermissionLevel.READ_ONLY,
  };
}

export function createLinkMemoryTool(memory?: any): ToolDefinition {
  const inputSchema = z.object({
    source: z.string(),
    target: z.string(),
    relation: z.enum(["depends_on", "used_by", "derived_from", "extends", "relates_to", "supersedes"]),
  });
  return {
    name: "link_memory",
    description: "Link two memories.",
    source: "builtin",
    inputSchema,
    execute: async (args) => {
      if (!memory) return { ok: true, output: "(memory service not connected)", data: {} };
      const r = inputSchema.safeParse(args);
      if (!r.success) return { ok: false, output: "", error: r.error.message };
      const linked = memory.link(r.data.source, r.data.target, r.data.relation);
      return linked === false
        ? { ok: false, output: "", error: "Memory link source or target not found" }
        : { ok: true, output: "Linked." };
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}

export function createForgetMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "forget_memory",
    description: "Delete a memory by its full or short hexadecimal ID. If only content is known, call search_memory first and use the returned <MemorySummary id>.",
    source: "builtin",
    inputSchema: memoryIdInputSchema,
    execute: async (args) => {
      if (!memory) return { ok: false, output: "", error: "memory service not connected" };
      const r = memoryIdInputSchema.safeParse(args);
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
