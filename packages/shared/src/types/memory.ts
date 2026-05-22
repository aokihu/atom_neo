export type MemoryScope = "core" | "short" | "long";

export type MemoryNode = {
  id: string;
  scope: MemoryScope;
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
