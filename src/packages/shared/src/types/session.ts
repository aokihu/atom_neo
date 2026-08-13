import type { ToolResultMetadata } from "./tool";

export type SessionMessage = {
  seq?: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  pipeline?: string;
  visible?: boolean;
  metadata?: Record<string, unknown>;
};

export type InferenceFact = {
  key: string;
  value: string;
  reason: string;
};

export type ToolResultEntry = {
  toolName: string;
  topic: string;
  timestamp: number;
  content?: string;
  metadata: ToolResultMetadata;
  durationMs?: number;
};

export type ToolContext = {
  mode: "idle" | "active" | "finished";
  results: ToolResultEntry[];
};

export type ScopeState = {
  status: "idle" | "loaded" | "searching";
  query: string;
};

export type MemoryScopeState = {
  core: ScopeState;
  short: ScopeState;
  long: ScopeState;
};

export type ContinuationContext = {
  summary: string;
  nextPrompt: string;
  avoidRepeat: string;
  updatedAt: number;
};
