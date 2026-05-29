import type { ToolResult } from "./tool";

export type SessionMessage = {
  role: "user" | "assistant" | "system" | "tool";
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

export type ToolContext = {
  mode: "idle" | "active" | "finished";
  results: ToolResult[];
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
