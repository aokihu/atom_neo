import { parseMemorySearchTerms } from "@atom-neo/shared";
import {
  calculateFinalMemoryScore,
  calculateGraphScore,
  calculateMemoryQuality,
  calculateRetrievalRelevance,
} from "../memory-ranking";
import type { MemoryKind } from "../memory-ranking";
import type { MemoryNode } from "./memory-types";
import type { MemoryStore } from "./memory-store";

export async function searchMemories(
  store: MemoryStore,
  query: string,
  limit = 3,
  kind?: MemoryKind,
): Promise<MemoryNode[]> {
  const terms = parseMemorySearchTerms(query);
  if (terms.length === 0) return [];

  const candidateLimit = Math.max(limit * 10, 30);
  const ranks = new Map<string, number>();
  const kindFilter = kind ? `AND nodes.kind = '${kind.replaceAll("'", "''")}'` : "";
  const ftsTerms = terms.filter((term) => Array.from(term).length >= 3);
  if (ftsTerms.length > 0) {
    const matchQuery = ftsTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
    const rows = store.all<{ id: string; rank: number }>(
      `SELECT nodes.id, bm25(memory_fts) AS rank
         FROM memory_fts JOIN nodes ON nodes.rowid = memory_fts.rowid
         WHERE memory_fts MATCH ? AND (nodes.expires_at IS NULL OR nodes.expires_at > ?) ${kindFilter}
         ORDER BY rank LIMIT ?`,
      [matchQuery, store.now, candidateLimit],
    );
    for (const row of rows) ranks.set(row.id, row.rank);
  }

  const shortTerms = terms.filter((term) => Array.from(term).length < 3);
  if (shortTerms.length > 0) {
    const where = shortTerms
      .map(() => "instr(lower(summary), lower(?)) > 0 OR instr(lower(content), lower(?)) > 0 OR instr(lower(tags), lower(?)) > 0")
      .join(" OR ");
    const params = shortTerms.flatMap((term) => [term, term, term]);
    const rows = store.all<{ id: string }>(
      `SELECT id FROM nodes WHERE (${where}) AND (expires_at IS NULL OR expires_at > ?) ${kindFilter} LIMIT ?`,
      [...params, store.now, candidateLimit],
    );
    for (const row of rows) if (!ranks.has(row.id)) ranks.set(row.id, 0);
  }

  if (ranks.size === 0) return [];

  const candidates = [...ranks.keys()]
    .map((id) => store.loadNode(id))
    .filter((node): node is MemoryNode => node !== null)
    .filter((node) => !store.isSuperseded(node.id))
    .filter((node) => {
      if (terms.length < 5) return true;
      return matchedTermCount(node, terms) / terms.length >= 0.4;
    });
  const rankOrder = new Map(
    candidates
      .map((node) => node.id)
      .sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0))
      .map((id, index) => [id, index]),
  );
  const nodes = candidates
    .map((node) => {
      const relevance = calculateRetrievalRelevance({
        matchedTermCount: matchedTermCount(node, terms),
        totalTermCount: terms.length,
        rankIndex: rankOrder.get(node.id) ?? candidates.length - 1,
        candidateCount: candidates.length,
      });
      return { node, score: calculateFinalMemoryScore(relevance, calculateNodeQuality(store, node)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ node }) => node);

  store.recordRetrievals(nodes.map((node) => node.id));
  return nodes;
}

export function calculateNodeQuality(store: MemoryStore, node: MemoryNode): number {
  const references = store.all<{ relation: string; sourceBaseWeight: number }>(
    `SELECT edges.relation, nodes.base_weight AS sourceBaseWeight
       FROM edges JOIN nodes ON nodes.id = edges.source_id
       WHERE edges.target_id = ? AND edges.relation != 'supersedes'`,
    [node.id],
  );
  return calculateMemoryQuality({
    baseWeight: node.baseWeight,
    usageScore: node.usageScore,
    usageUpdatedAt: node.usageUpdatedAt,
    retrievalCount: node.retrievalCount,
    readCount: node.readCount,
    graphScore: calculateGraphScore(references),
    kind: node.kind,
    confidence: node.confidence,
    pinned: node.pinned,
    lastConfirmedAt: node.lastConfirmedAt,
    createdAt: node.createdAt,
    now: store.now,
  });
}

function matchedTermCount(node: MemoryNode, terms: string[]): number {
  const text = `${node.summary}\n${node.content}\n${node.tags.join(" ")}`.toLowerCase();
  return terms.filter((term) => text.includes(term)).length;
}
