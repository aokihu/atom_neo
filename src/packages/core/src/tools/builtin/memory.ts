import { z } from "zod";
import type { ToolDefinition } from "@atom-neo/shared";
import { PermissionLevel, MEMORY_KIND_VALUES } from "@atom-neo/shared";
import { toolResult } from "../outcome";

const searchMemoryInputSchema = z.object({
  query: z.string().describe("搜索核心概念、同义词、领域词或 Skill 名称；删除年份、\"最新\"等实时限定词"),
  kind: z.enum(MEMORY_KIND_VALUES).optional().describe("按类型过滤：stable_fact/decision/preference/identity 为事实类，workflow/temporary_state 为技能流程类"),
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
  kind: z.enum(MEMORY_KIND_VALUES).optional(),
  ttlSeconds: z.number().int().positive().optional()
    .describe("Optional hard expiry. Defaults to 7 days for temporary_state and 6 hours for realtime_data."),
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
  const kind = node.kind ? ` kind="${node.kind}"` : "";
  const expiresAt = node.expiresAt ? ` expiresAt="${new Date(node.expiresAt).toISOString()}"` : "";
  return `<MemorySummary id="${id}" tags="${tags}"${kind}${expiresAt}>\n${node.summary}\n</MemorySummary>`;
}

function formatMemoryTraversalSummary(node: any): string {
  const id = String(node.id).slice(0, 6);
  const tags = Array.isArray(node.tags) ? node.tags.join(",") : "";
  const sourceId = node.sourceId ? ` sourceId="${String(node.sourceId).slice(0, 6)}"` : "";
  const relation = node.relation ? ` relation="${node.relation}"` : "";
  const direction = node.direction ? ` direction="${node.direction}"` : "";
  return `<MemorySummary id="${id}" tags="${tags}"${sourceId}${relation}${direction} depth="${node.depth}">\n${node.summary}\n</MemorySummary>`;
}

export function createSearchMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "search_memory",
    description: "Search memory summaries with broad terms. Call read_memory with a returned ID only after confirming that a candidate is relevant.",
    source: "builtin",
    inputSchema: searchMemoryInputSchema,
    execute: async (args) => {
      if (!memory) {
        return toolResult.failure("memory service not connected");
      }
      const r = searchMemoryInputSchema.safeParse(args);
      if (!r.success) return toolResult.failure(r.error.message);
      const nodes = await memory.search(r.data.query, r.data.limit, r.data.kind);
      if (nodes.length === 0) return toolResult.none();
      const output = nodes.map(formatMemorySummary).join("\n");
      return toolResult.reference(output);
    },
    permission: PermissionLevel.READ_ONLY,
    allowSameToolBatch: true,
  };
}

export function createReadMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "read_memory",
    description: "Read the full content of a relevant memory. The result includes relatedCount; call traverse_memory when those relations may help. Optionally inject it into Context with pinned session retention or a temporary topic TTL.",
    source: "builtin",
    inputSchema: readMemoryInputSchema,
    execute: async (args) => {
      if (!memory) return toolResult.failure("memory service not connected");
      const result = readMemoryInputSchema.safeParse(args);
      if (!result.success) return toolResult.failure(result.error.message);
      const node = memory.getById(result.data.id);
      if (!node) return toolResult.failure(`Memory not found: ${result.data.id}`);
      memory.recordRead?.(node.id);
      const id = String(node.id).slice(0, 6);
      const tags = Array.isArray(node.tags) ? node.tags.join(",") : "";
      const kind = node.kind ? ` kind="${node.kind}"` : "";
      const expiresAt = node.expiresAt ? ` expiresAt="${new Date(node.expiresAt).toISOString()}"` : "";
      const relatedCount = memory.countRelated?.(node.id) ?? 0;
      const output = `<Memory id="${id}" tags="${tags}"${kind}${expiresAt} relatedCount="${relatedCount}">\n${node.content}\n</Memory>`;
      const retention = result.data.injectToContext;
      const contextInjection = retention
        ? {
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
          }
        : undefined;
      return toolResult.reference(output, contextInjection);
    },
    permission: PermissionLevel.READ_ONLY,
    allowSameToolBatch: true,
  };
}

export function createSaveMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "save_memory",
    description: "Save full memory content with an optional concise summary and tags. Set supersedesId when this content replaces an existing memory.",
    source: "builtin",
    inputSchema: saveMemoryInputSchema,
    execute: async (args) => {
      if (!memory) return toolResult.failure("memory service not connected");
      const r = saveMemoryInputSchema.safeParse(args);
      if (!r.success) return toolResult.failure(r.error.message);
      try {
        const ttlSeconds = r.data.ttlSeconds
          ?? (r.data.kind === "realtime_data" ? 6 * 60 * 60
            : r.data.kind === "temporary_state" ? 7 * 24 * 60 * 60
              : undefined);
        const id = memory.save(r.data.content, r.data.tags, r.data.summary, {
          baseWeight: r.data.baseWeight,
          kind: r.data.kind,
          confidence: r.data.confidence,
          pinned: r.data.pinned,
          ttlSeconds,
          supersedesId: r.data.supersedesId,
        });
        return toolResult.stateChanged(`Saved memory: ${id.slice(0, 8)}...`);
      } catch (err) {
        return toolResult.failure(err instanceof Error ? err.message : String(err));
      }
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}

export function createTraverseMemoryTool(memory?: any): ToolDefinition {
  return {
    name: "traverse_memory",
    description: "Traverse incoming and outgoing memory relations and return related summaries. Use read_memory to retrieve selected full content.",
    source: "builtin",
    inputSchema: z.object({ startId: z.string(), maxSteps: z.number().optional().default(4) }),
    execute: async (args) => {
      if (!memory) {
        return toolResult.failure("memory service not connected");
      }
      const r = z.object({ startId: z.string(), maxSteps: z.number().optional().default(4) }).safeParse(args);
      if (!r.success) return toolResult.failure(r.error.message);
      const nodes = memory.traverse(r.data.startId, r.data.maxSteps);
      if (nodes.length === 0) return toolResult.none();
      return toolResult.reference(nodes.map(formatMemoryTraversalSummary).join("\n"));
    },
    permission: PermissionLevel.READ_ONLY,
    allowSameToolBatch: true,
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
      if (!memory) {
        return toolResult.failure("memory service not connected");
      }
      const r = inputSchema.safeParse(args);
      if (!r.success) return toolResult.failure(r.error.message);
      const linked = memory.link(r.data.source, r.data.target, r.data.relation);
      return linked === false
        ? toolResult.failure("Memory link source or target not found")
        : toolResult.stateChanged("Linked.");
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
      if (!memory) return toolResult.failure("memory service not connected");
      const r = memoryIdInputSchema.safeParse(args);
      if (!r.success) return toolResult.failure(r.error.message);
      try {
        const forgotten = memory.forget(r.data.id);
        return forgotten
          ? toolResult.stateChanged(`Forgot memory: ${r.data.id}`)
          : toolResult.failure(`Memory not found: ${r.data.id}`);
      } catch (err) {
        return toolResult.failure(err instanceof Error ? err.message : String(err));
      }
    },
    permission: PermissionLevel.FILE_WRITE,
  };
}
