# Memory Service — Design & API

> **Purpose**: Complete specification for the memory graph database.
> Memory is stored as a graph (nodes + edges) with FTS5 full-text search.

---

## 1. Database Schema

```sql
-- packages/core/src/memory/schema.sql

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
  weight REAL DEFAULT 1.0,          -- Edge weight for traversal
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
  key,
  type,
  content,
  category,
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
END;
```

---

## 2. Memory Service API

```typescript
// packages/core/src/memory/service.ts

export interface MemoryNode {
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
}

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
  save(node: Omit<MemoryNode, "id" | "createdAt" | "updatedAt">): Promise<MemoryNode>;

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
  getNeighbors(key: string, direction?: "in" | "out" | "both"): MemoryLink[];

  // === Recall ===
  recallSessionContext(sessionId: string): Promise<MemoryNode[]>;

  // === Delete ===
  delete(key: string): Promise<void>;

  // === Stats ===
  getStats(): Promise<{ nodeCount: number; linkCount: number; dbSizeBytes: number }>;
}
```

---

## 3. FTS5 Search Implementation

```typescript
async search(params: { query: string; scope?: string; limit?: number }): Promise<MemorySearchResult[]> {
  const { query, scope, limit = 10 } = params;

  // Use FTS5 with term expansion and relevance ranking
  const stmt = this.#db.prepare(`
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
  `);

  const rows = stmt.all(query, limit);
  // If FTS5 returns nothing, fall back to LIKE search
  // ...
}
```

---

## 4. Graph Traversal Algorithm

```typescript
async traverse(params: TraverseParams): Promise<TraverseResult> {
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
    // Start from a known key
    queue.push({ key: startKey, hops: 0, relevance: 1.0 });
  } else {
    // Seed from FTS5 match
    const seeds = this.search({ query: goal, limit: 3 });
    for (const seed of seeds) {
      queue.push({ key: seed.memory.key, hops: 0, relevance: seed.retrieval.relevance });
    }
  }

  let entryKey: string | null = startKey ?? queue[0]?.key ?? null;

  while (queue.length > 0 && outputs.length < limit && visited.size < maxSteps * maxCandidatesPerStep) {
    const current = queue.shift()!;
    if (visited.has(current.key)) continue;
    visited.add(current.key);

    // Get node + all neighbors
    const node = this.getNode(current.key);
    const neighbors = this.getNeighbors(current.key, direction);
    const paths = [current.key, ...neighbors.map(n => n.targetKey)];

    // Score each path against goal
    for (const pathKey of paths) {
      if (visited.has(pathKey)) continue;
      const relevance = this.scoreRelevance(pathKey, goal);
      if (relevance > 0.3) {
        queue.push({ key: pathKey, hops: current.hops + 1, relevance });
      }
    }

    // Sort queue by relevance
    queue.sort((a, b) => b.relevance - a.relevance);
  }

  return {
    outputs,
    status: outputs.length > 0 ? "found" : "not_found",
    stopReason: outputs.length >= limit ? "limit_reached" : "exhausted",
    path: [...visited],
    hops: visited.size,
    entryKey,
  };
}
```

---

## 5. Domain Entry Points

```typescript
// Predefined domain categories that new memories auto-link to:
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
      await this.link({ sourceKey: node.key, targetKey: domainKey, relation: "belongs_to" });
    }
  }

  return saved;
}
```

---

## 6. Scoring / Relevance

```typescript
function scoreRelevance(nodeKey: string, goal: string): number {
  const node = this.getNode(nodeKey);
  if (!node) return 0;

  // Simple TF-IDF-like scoring:
  let score = 0;

  // Content match
  const contentWords = node.content.toLowerCase().split(/\s+/);
  const goalWords = goal.toLowerCase().split(/\s+/);
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
}
```
