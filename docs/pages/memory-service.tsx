import React from "react";
import type { DocPageProps } from "./shared";
import { PageHeader, Section, CodeBlock, Callout, ComparisonTable, Badge } from "./shared";

export default function DocPage({ content, title, description, category }: DocPageProps) {
  return (
    <div className="doc-page">
      <PageHeader title={title} description={description} category={category} readTime={Math.max(1, Math.ceil(content.split(/\s+/).length / 200))} />

      {/* ── Database Schema ── */}
      <Section title="数据库 Schema">
        <ComparisonTable
          headers={["表", "关键列", "说明"]}
          rows={[
            [<strong>memory_nodes</strong>, <code>key, type, content, category, importance</code>, "核心记忆节点表；唯一键标识"],
            [<strong>memory_links</strong>, <code>source_key, target_key, relation, weight</code>, "节点间关系；支持多种关系类型"],
            [<strong>memory_events</strong>, <code>node_key, action, previous_content</code>, "审计事件日志；变更追踪"],
            [<><strong>memory_fts</strong> <Badge color="blue">FTS5</Badge></>, <code>key, type, content, category</code>, "虚拟表全文搜索；触发器自动同步"],
          ]}
        />
        <CodeBlock lang="sql" code={`-- src/packages/core/src/memory/schema.sql

CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,          -- Unique identifier like "file:src/main.ts"
  type TEXT NOT NULL,                -- fact | preference | constraint
  content TEXT NOT NULL,             -- The actual memory content
  category TEXT,                     -- project_context | user_preference | decision | ...
  importance REAL DEFAULT 0.5,       -- 0.0 to 1.0
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_links (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL REFERENCES memory_nodes(key),
  target_key TEXT NOT NULL REFERENCES memory_nodes(key),
  relation TEXT NOT NULL,            -- relates_to | depends_on | contradicts | extends
  weight REAL DEFAULT 1.0,           -- Edge weight for traversal
  created_at INTEGER NOT NULL,
  UNIQUE(source_key, target_key, relation)
);

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  node_key TEXT NOT NULL REFERENCES memory_nodes(key),
  action TEXT NOT NULL,              -- created | updated | deleted
  previous_content TEXT,             -- For update tracking
  timestamp INTEGER NOT NULL
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  key, type, content, category,
  content=memory_nodes,
  content_rowid=rowid
);

-- Triggers to keep FTS5 in sync
CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memory_nodes BEGIN
  INSERT INTO memory_fts(rowid, key, type, content, category)
  VALUES (new.rowid, new.key, new.type, new.content, new.category);
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memory_nodes BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, key, type, content, category)
  VALUES ('delete', old.rowid, old.key, old.type, old.content, old.category);
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON memory_nodes BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, key, type, content, category)
  VALUES ('delete', old.rowid, old.key, old.type, old.content, old.category);
  INSERT INTO memory_fts(rowid, key, type, content, category)
  VALUES (new.rowid, new.key, new.type, new.content, new.category);
END;`} />

        <Callout type="info" title="Schema 设计要点">
          图结构通过 <strong>nodes + links</strong> 双表建模。FTS5 虚拟表提供全文搜索，三组触发器确保数据自动同步。节点类型为 <code>fact | preference | constraint</code>，关系类型为 <code>relates_to | depends_on | contradicts | extends</code>。
        </Callout>
      </Section>

      {/* ── Types ── */}
      <Section title="核心类型定义">
        <CodeBlock lang="typescript" code={`export interface MemoryNode {
  id: string;
  key: string;
  type: "fact" | "preference" | "constraint";
  content: string;
  category?: string;
  importance: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryLink {
  id: string;
  sourceKey: string;
  targetKey: string;
  relation: string;
  weight: number;
  createdAt: number;
}

export interface MemorySearchResult {
  memory: MemoryNode;
  retrieval: {
    mode: "fts" | "graph";
    relevance: number;    // 0.0 to 1.0
    reason: string;
  };
}`} />
      </Section>

      {/* ── Memory Service API ── */}
      <Section title="MemoryService API">
        <ComparisonTable
          headers={["操作", "方法签名", "说明"]}
          rows={[
            [<Badge color="blue">search</Badge>, <code>search({"{"}query, scope?, limit?{"}"})</code>, "FTS5 全文搜索；返回排名的 MemorySearchResult[]"],
            [<Badge color="green">save</Badge>, <code>save(node: Omit&lt;MemoryNode, ...&gt;)</code>, "创建新记忆节点；自动链接到领域入口"],
            [<Badge color="purple">traverse</Badge>, <code>traverse({"{"}goal, startKey?, direction?, ...{"}"})</code>, "图遍历搜索；BFS 优先队列"],
            [<Badge color="orange">link</Badge>, <code>link({"{"}sourceKey, targetKey, relation{"}"})</code>, "在两个节点间创建关系边"],
            [<Badge color="blue">getNeighbors</Badge>, <code>getNeighbors(key, direction)</code>, "获取节点的所有邻居关系"],
            [<Badge color="purple">recallSessionContext</Badge>, <code>recallSessionContext(sessionId)</code>, "按 session 召回上下文化记忆"],
            [<Badge color="red">delete</Badge>, <code>delete(key)</code>, "删除记忆节点及其关联数据"],
            [<Badge color="blue">getStats</Badge>, <code>getStats()</code>, "返回 nodeCount / linkCount / dbSizeBytes"],
          ]}
        />

        <CodeBlock lang="typescript" code={`// src/packages/core/src/memory/service.ts

export class MemoryService implements Startable, Stoppable {
  constructor(params: { dbPath: string }) { }

  async start(): Promise<void> { }
  async stop(): Promise<void> { }

  // === Search ===
  search(params: {
    query: string;
    scope?: "core" | "short" | "long";
    limit?: number;
  }): MemorySearchResult[];

  // === Save ===
  save(node: Omit<MemoryNode, "id" | "createdAt" | "updatedAt">):
    Promise<MemoryNode>;

  // === Traverse ===
  traverse(params: {
    goal: string;
    scope?: string;
    startKey?: string;
    direction?: "forward" | "backward" | "both";
    strategy?: "graph_first" | "seed_then_graph";
    maxSteps?: number;
    maxCandidatesPerStep?: number;
    limit?: number;
  }): TraverseResult;

  // === Link ===
  link(params: {
    sourceKey: string;
    targetKey: string;
    relation: string;
    weight?: number;
  }): Promise<MemoryLink>;

  // === Neighbors ===
  getNeighbors(key: string,
    direction?: "in" | "out" | "both"): MemoryLink[];

  // === Recall ===
  recallSessionContext(sessionId: string): Promise<MemoryNode[]>;

  // === Delete ===
  delete(key: string): Promise<void>;

  // === Stats ===
  getStats(): Promise<{
    nodeCount: number; linkCount: number; dbSizeBytes: number;
  }>;
}`} />
      </Section>

      {/* ── FTS5 Search ── */}
      <Section title="FTS5 全文搜索">
        <Callout type="tip" title="FTS5 搜索工作方式">
          <p>使用 SQLite FTS5 扩展结合 <strong>BM25 排名</strong>。当 FTS5 无结果时自动回退到 <code>LIKE</code> 搜索。搜索模式标记为 <Badge color="blue">fts</Badge> 或 <Badge color="green">graph</Badge>。</p>
        </Callout>
        <CodeBlock lang="typescript" code={`async search(params: {
  query: string; scope?: string; limit?: number;
}): Promise<MemorySearchResult[]> {
  const { query, scope, limit = 10 } = params;

  // Use FTS5 with term expansion and relevance ranking
  const stmt = this.#db.prepare(\`
    SELECT
      mn.*,
      rank,
      'fts' as retrieval_mode,
      CAST(1.0 / (rank + 1) AS REAL) as relevance
    FROM memory_fts mf
    JOIN memory_nodes mn ON mn.rowid = mf.rowid
    WHERE memory_fts MATCH ?1
    ORDER BY rank
    LIMIT ?2
  \`);

  const rows = stmt.all(query, limit);
  // If FTS5 returns nothing, fall back to LIKE search
  // ...
}`} />
      </Section>

      {/* ── Graph Traversal ── */}
      <Section title="图遍历算法">
        <CodeBlock lang="typescript" code={`async traverse(params: TraverseParams): Promise<TraverseResult> {
  const {
    goal, startKey, direction = "both",
    strategy = "graph_first", maxSteps = 10,
    maxCandidatesPerStep = 5, limit = 10,
  } = params;

  const visited = new Set<string>();
  const queue: TraverseQueueItem[] = [];
  const outputs: MemorySearchResult[] = [];

  // Seed the queue
  if (startKey) {
    queue.push({ key: startKey, hops: 0, relevance: 1.0 });
  } else {
    const seeds = this.search({ query: goal, limit: 3 });
    for (const seed of seeds) {
      queue.push({
        key: seed.memory.key,
        hops: 0,
        relevance: seed.retrieval.relevance,
      });
    }
  }

  while (queue.length > 0
      && outputs.length < limit
      && visited.size < maxSteps * maxCandidatesPerStep) {
    const current = queue.shift()!;
    if (visited.has(current.key)) continue;
    visited.add(current.key);

    const node = this.getNode(current.key);
    const neighbors = this.getNeighbors(current.key, direction);

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.targetKey)) continue;
      const relevance = this.scoreRelevance(neighbor.targetKey, goal);
      if (relevance > 0.3) {
        queue.push({
          key: neighbor.targetKey,
          hops: current.hops + 1,
          relevance,
        });
      }
    }

    queue.sort((a, b) => b.relevance - a.relevance);
  }

  return {
    outputs,
    status: outputs.length > 0 ? "found" : "not_found",
    stopReason: outputs.length >= limit ? "limit_reached" : "exhausted",
    path: [...visited],
    hops: visited.size,
    entryKey: startKey ?? queue[0]?.key ?? null,
  };
}`} />
      </Section>

      {/* ── Domain Entry Points ── */}
      <Section title="领域入口点">
        <CodeBlock lang="typescript" code={`// Predefined domain categories that new memories auto-link to:
const DOMAIN_ENTRY_POINTS = [
  "user_profile",        // User identity, preferences
  "user_preference",     // Stated preferences
  "project_context",     // Project structure, technology
  "project_rules",       // Code conventions, linting rules
  "decisions",            // Architecture decisions, tradeoffs
];

// When saving a new memory, auto-link to relevant domains:
async save(node: MemoryNodeInput): Promise<MemoryNode> {
  const saved = await this.#insertNode(node);

  // Auto-link to domain entry points based on category
  if (node.category) {
    const domainKey = mapCategoryToDomain(node.category);
    if (domainKey) {
      await this.link({
        sourceKey: node.key,
        targetKey: domainKey,
        relation: "belongs_to",
      });
    }
  }

  return saved;
}`} />
      </Section>

      {/* ── Scoring / Relevance ── */}
      <Section title="相关性评分">
        <CodeBlock lang="typescript" code={`function scoreRelevance(nodeKey: string, goal: string): number {
  const node = this.getNode(nodeKey);
  if (!node) return 0;

  let score = 0;

  // Content match (TF-IDF-like)
  const contentWords = node.content.toLowerCase().split(/\\s+/);
  const goalWords = goal.toLowerCase().split(/\\s+/);
  for (const word of goalWords) {
    if (contentWords.includes(word)) score += 0.3;
  }

  // Key match (exact key contains goal word)
  for (const word of goalWords) {
    if (node.key.toLowerCase().includes(word)) score += 0.5;
  }

  // Importance bonus
  score += node.importance * 0.2;

  return Math.min(score, 1.0);
}`} />
        <Callout type="info">
          评分按内容匹配（+0.3/词）、键匹配（+0.5/词）、重要性加成（importance × 0.2）三部分组成。最高 1.0。
        </Callout>
      </Section>
    </div>
  );
}
