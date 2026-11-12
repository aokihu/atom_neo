import type { MemoryKind } from "./memory-ranking";

export type { MemoryKind } from "./memory-ranking";

export type MemoryNode = {
  id: string;
  content: string;
  summary: string;
  tags: string[];
  baseWeight: number;
  usageScore: number;
  retrievalCount: number;
  readCount: number;
  kind: MemoryKind;
  confidence: number;
  pinned: boolean;
  expiresAt: number | null;
  lastReadAt: number | null;
  lastConfirmedAt: number | null;
  usageUpdatedAt: number | null;
  createdAt: number;
  accessedAt: number;
};

export type MemorySaveOptions = {
  baseWeight?: number;
  kind?: MemoryKind;
  confidence?: number;
  pinned?: boolean;
  ttlSeconds?: number;
  supersedesId?: string;
};

export type MemoryTraversalNode = MemoryNode & {
  sourceId: string | null;
  relation: string | null;
  direction: "incoming" | "outgoing" | null;
  depth: number;
};
