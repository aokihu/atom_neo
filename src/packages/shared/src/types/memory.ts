export type MemoryScope = "core" | "short" | "long";

export const MEMORY_KIND_VALUES = [
  "identity",
  "preference",
  "stable_fact",
  "decision",
  "workflow",
  "temporary_state",
  "realtime_data",
] as const;

export type MemoryKind = typeof MEMORY_KIND_VALUES[number];

export type MemoryNode = {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  summary: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sourceTaskId: string | null;
  sourceToolCallId: string | null;
};

export type MemoryLink = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationship: string;
  weight: number;
  createdAt: number;
};

export type MemorySearchRequest = {
  query: string;
  scope?: MemoryScope;
  limit?: number;
  threshold?: number;
};

export type MemorySearchResult = {
  node: MemoryNode;
  score: number;
  links: MemoryLink[];
};
