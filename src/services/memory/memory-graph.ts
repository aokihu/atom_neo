import type { MemoryTraversalNode } from "./memory-types";
import type { MemoryStore } from "./memory-store";
import { calculateNodeQuality } from "./memory-query";

export function traverseMemories(store: MemoryStore, startId: string, maxSteps = 4): MemoryTraversalNode[] {
  const fullStartId = store.findFullId(startId);
  if (!fullStartId) return [];
  const visited = new Set<string>();
  const results: MemoryTraversalNode[] = [];
  const queue: Array<{
    id: string;
    depth: number;
    sourceId: string | null;
    relation: string | null;
    direction: "incoming" | "outgoing" | null;
  }> = [{ id: fullStartId, depth: 0, sourceId: null, relation: null, direction: null }];

  while (queue.length > 0 && results.length < 5) {
    const { id, depth, sourceId, relation, direction } = queue.shift()!;
    if (visited.has(id) || depth >= maxSteps) continue;
    visited.add(id);

    const node = store.loadNode(id);
    if (!node) continue;
    results.push({ ...node, sourceId, relation, direction, depth });

    const neighbors = store.all<{
      id: string;
      relation: string;
      direction: "incoming" | "outgoing";
    }>(
      `SELECT target_id AS id, relation, 'outgoing' AS direction FROM edges WHERE source_id = ?
         UNION ALL
         SELECT source_id AS id, relation, 'incoming' AS direction FROM edges WHERE target_id = ?`,
      [id, id],
    );
    neighbors.sort((a, b) => {
      const aNode = store.loadNode(a.id);
      const bNode = store.loadNode(b.id);
      return (bNode ? calculateNodeQuality(store, bNode) : 0) - (aNode ? calculateNodeQuality(store, aNode) : 0);
    });

    for (const neighbor of neighbors.slice(0, 3)) {
      if (!visited.has(neighbor.id)) {
        queue.push({
          id: neighbor.id,
          depth: depth + 1,
          sourceId: id,
          relation: neighbor.relation,
          direction: neighbor.direction,
        });
      }
    }
  }

  store.recordRetrievals(results.map((node) => node.id));
  return results;
}

export function linkMemories(store: MemoryStore, source: string, target: string, relation: string): boolean {
  const sourceId = store.findFullId(source);
  const targetId = store.findFullId(target);
  if (!sourceId || !targetId) return false;
  store.run(
    "INSERT OR IGNORE INTO edges (source_id, target_id, relation) VALUES (?, ?, ?)",
    [sourceId, targetId, relation],
  );
  return true;
}

export function countRelatedMemories(store: MemoryStore, memoryId: string): number {
  const fullMemoryId = store.findFullId(memoryId);
  if (!fullMemoryId) return 0;
  const row = store.get<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM (
         SELECT target_id AS id FROM edges WHERE source_id = ?
         UNION
         SELECT source_id AS id FROM edges WHERE target_id = ?
       ) related
       JOIN nodes ON nodes.id = related.id
       WHERE related.id != ? AND (nodes.expires_at IS NULL OR nodes.expires_at > ?)`,
    [fullMemoryId, fullMemoryId, fullMemoryId, store.now],
  )!;
  return row.count;
}
