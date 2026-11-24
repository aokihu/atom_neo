import type { ToolResultMetadata } from "./tool";

export type SessionTelemetry = {
  sessionId: string;
  rounds: {
    goalId: string;
    globalUsed: number;
    globalAllowance: number;
    localUsed: number;
    localLimit: number;
    completed?: boolean;
    pause?: "global_limit" | "health_check" | "unhealthy" | "unknown" | "cancelled" | "interrupted";
  } | null;
  todos: { content: string; status: "pending" | "in_progress" | "completed" | "cancelled"; priority: "high" | "medium" | "low" }[];
};

export type SessionInitiator =
  | { type: "tui" }
  | { type: "gateway"; clientId: string; platform: string }
  | { type: "internal" }
  | { type: "unknown" };

/** Read-only History DTO shared by Core and MenuApp. */
export type SessionSummary = {
  sessionId: string;
  lastTuiUsedAt: number;
  initiator: SessionInitiator;
  status: string;
  /** Holds an active task lease. */
  active: boolean;
  /** Reference-counted WS/TUI attach; zero releases deletion and sweep protection. */
  attached: boolean;
};

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
