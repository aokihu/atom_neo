import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { calculateDecayedUsage } from "./memory-ranking";
import { SqliteDatabase } from "../storage/sqlite-database";
import type { SqliteStatementResult, SqliteValue } from "../storage/sqlite-database";
import type { MemoryKind, MemoryNode, MemorySaveOptions } from "./memory-types";
import { initializeMemorySchema, migrateLegacyContent } from "./memory-schema";

export type MemoryStoreOptions = {
  dbPath: string;
  legacyNodesPath?: string;
  now?: () => number;
};

export class MemoryStore {
  #db: SqliteDatabase | null = null;
  #dbPath: string;
  #legacyNodesPath?: string;
  #now: () => number;

  constructor(params: MemoryStoreOptions) {
    this.#dbPath = params.dbPath;
    this.#legacyNodesPath = params.legacyNodesPath;
    this.#now = params.now ?? Date.now;
  }

  get now(): number {
    return this.#now();
  }

  get isOpen(): boolean {
    return this.#db !== null;
  }

  open(): void {
    try {
      mkdirSync(dirname(this.#dbPath), { recursive: true });
      this.#db = new SqliteDatabase(this.#dbPath);
      const searchIndexCreated = initializeMemorySchema(this.#db);
      if (searchIndexCreated) this.#db.run("INSERT INTO memory_fts(memory_fts) VALUES ('rebuild')");
      migrateLegacyContent(this.#db, this.#legacyNodesPath);
    } catch (error) {
      this.#db?.close();
      this.#db = null;
      throw error;
    }
  }

  close(): void {
    this.#db?.close();
    this.#db = null;
  }

  run(sql: string, params: readonly SqliteValue[] = []): SqliteStatementResult {
    return this.#dbHandle().run(sql, params);
  }

  get<T = Record<string, unknown>>(sql: string, params: readonly SqliteValue[] = []): T | undefined {
    return this.#dbHandle().prepare(sql).get(...params) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, params: readonly SqliteValue[] = []): T[] {
    return this.#dbHandle().prepare(sql).all(...params) as T[];
  }

  transaction<T>(fn: () => T): T {
    return this.#dbHandle().transaction(fn)();
  }

  save(content: string, tags: string[] = [], summary?: string, options: MemorySaveOptions = {}): string {
    const hash = createHash("sha256").update(content).digest("hex");
    const now = this.#now();
    const storedSummary = this.#selectSummary(content, summary);
    const baseWeight = Math.min(100, Math.max(0, options.baseWeight ?? 60));
    const kind = options.kind ?? "stable_fact";
    const confidence = Math.min(1, Math.max(0, options.confidence ?? 1));
    const pinned = options.pinned ? 1 : 0;
    const expiresAt = options.ttlSeconds === undefined
      ? null
      : now + Math.max(1, Math.floor(options.ttlSeconds)) * 1_000;
    const supersededMemoryId = options.supersedesId ? this.findFullId(options.supersedesId) : null;
    if (options.supersedesId && !supersededMemoryId) {
      throw new Error(`Memory not found: ${options.supersedesId}`);
    }
    if (supersededMemoryId === hash) {
      throw new Error("A memory cannot supersede itself");
    }
    this.transaction(() => {
      this.run(
        `INSERT INTO nodes (
           id, content, summary, tags, weight, access_count, base_weight, usage_score,
           retrieval_count, read_count, kind, confidence, pinned, expires_at, last_confirmed_at,
           usage_updated_at, created_at, accessed_at
         ) VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           summary = excluded.summary,
           tags = excluded.tags,
           base_weight = MAX(nodes.base_weight, excluded.base_weight),
           weight = MAX(nodes.weight, excluded.weight),
           kind = CASE WHEN ? THEN excluded.kind ELSE nodes.kind END,
           confidence = CASE WHEN ? THEN excluded.confidence ELSE nodes.confidence END,
           pinned = MAX(nodes.pinned, excluded.pinned),
           expires_at = CASE WHEN ? THEN excluded.expires_at ELSE nodes.expires_at END,
           last_confirmed_at = excluded.last_confirmed_at,
           accessed_at = excluded.accessed_at`,
        [
          hash, content, storedSummary, tags.join(","), baseWeight, baseWeight, kind, confidence,
          pinned, expiresAt, now, now, now, now,
          options.kind !== undefined, options.confidence !== undefined, options.ttlSeconds !== undefined,
        ],
      );
      if (supersededMemoryId) {
        this.run(
          "INSERT OR IGNORE INTO edges (source_id, target_id, relation) VALUES (?, ?, 'supersedes')",
          [hash, supersededMemoryId],
        );
      }
    });
    return hash;
  }

  getById(memoryId: string): MemoryNode | null {
    const fullMemoryId = this.findFullId(memoryId);
    return fullMemoryId ? this.loadNode(fullMemoryId) : null;
  }

  findFullId(memoryId: string): string | null {
    const key = memoryId.trim().toLowerCase();
    if (!/^[a-f0-9]+$/.test(key)) return null;

    const now = this.#now();
    const exact = this.get<{ id: string }>(
      "SELECT id FROM nodes WHERE id = ? AND (expires_at IS NULL OR expires_at > ?)",
      [key, now],
    );
    if (exact) return exact.id;

    const rows = this.all<{ id: string }>(
      "SELECT id FROM nodes WHERE id LIKE ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY id LIMIT 2",
      [`${key}%`, now],
    );
    return rows.length === 1 ? rows[0].id : null;
  }

  forget(id: string): boolean {
    const fullMemoryId = this.findFullId(id);
    if (!fullMemoryId) return false;

    const result = this.transaction(() => {
      this.run("DELETE FROM edges WHERE source_id = ? OR target_id = ?", [fullMemoryId, fullMemoryId]);
      return this.run("DELETE FROM nodes WHERE id = ?", [fullMemoryId]);
    });
    return result.changes > 0;
  }

  retain(id: string): void {
    const fullMemoryId = this.findFullId(id);
    if (!fullMemoryId) return;
    const now = this.#now();
    this.run(
      `UPDATE nodes SET
         base_weight = MIN(100, base_weight + 10),
         weight = MIN(100, weight + 10),
         last_confirmed_at = ?,
         accessed_at = ?
       WHERE id = ?`,
      [now, now, fullMemoryId],
    );
  }

  recordRead(id: string): void {
    const row = this.get<{ usage_score: number; usage_updated_at: number | null }>(
      "SELECT usage_score, usage_updated_at FROM nodes WHERE id = ?",
      [id],
    );
    if (!row) return;
    const now = this.#now();
    const usageScore = calculateDecayedUsage(row.usage_score, row.usage_updated_at, now) + 1;
    this.run(
      `UPDATE nodes SET
         usage_score = ?,
         read_count = read_count + 1,
         access_count = access_count + 1,
         last_read_at = ?,
         usage_updated_at = ?,
         accessed_at = ?
       WHERE id = ?`,
      [usageScore, now, now, now, id],
    );
  }

  recordRetrievals(ids: string[]): void {
    if (ids.length === 0) return;
    const markRetrieved = this.#dbHandle().prepare(
      "UPDATE nodes SET retrieval_count = retrieval_count + 1, accessed_at = ? WHERE id = ?",
    );
    const now = this.#now();
    this.transaction(() => {
      for (const id of new Set(ids)) markRetrieved.run(now, id);
    });
  }

  isSuperseded(id: string): boolean {
    return Boolean(this.get(
      "SELECT 1 FROM edges WHERE target_id = ? AND relation = 'supersedes' LIMIT 1",
      [id],
    ));
  }

  loadNode(id: string): MemoryNode | null {
    const row = this.get<any>("SELECT * FROM nodes WHERE id = ?", [id]);
    if (!row || (row.expires_at !== null && row.expires_at <= this.#now())) return null;
    return {
      id: row.id,
      content: row.content as string,
      summary: row.summary as string,
      tags: row.tags ? (row.tags as string).split(",").filter(Boolean) : [],
      baseWeight: row.base_weight as number,
      usageScore: row.usage_score as number,
      retrievalCount: row.retrieval_count as number,
      readCount: row.read_count as number,
      kind: row.kind as MemoryKind,
      confidence: row.confidence as number,
      pinned: Boolean(row.pinned),
      expiresAt: row.expires_at as number | null,
      lastReadAt: row.last_read_at as number | null,
      lastConfirmedAt: row.last_confirmed_at as number | null,
      usageUpdatedAt: row.usage_updated_at as number | null,
      createdAt: row.created_at as number,
      accessedAt: row.accessed_at as number,
    };
  }

  #dbHandle(): SqliteDatabase {
    if (!this.#db) throw new Error("MemoryService is not started");
    return this.#db;
  }

  #selectSummary(content: string, summary?: string): string {
    const candidate = summary?.trim();
    if (!candidate) return content;
    const contentLength = Array.from(content).length;
    const summaryLength = Array.from(candidate).length;
    return contentLength === 0 || summaryLength >= contentLength * 0.8 ? content : candidate;
  }
}
