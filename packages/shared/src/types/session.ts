export type ToolContextMode = "idle" | "executing";

export type MemoryScopeState = "idle" | "searching" | "saving";

export type SessionContextData = {
  sessionId: string;
  messages: SessionMessage[];
  inferenceContext: {
    hiddenFacts: string[];
  };
  toolContext: {
    mode: ToolContextMode;
  };
  memoryScopes: {
    core: MemoryScopeState;
    short: MemoryScopeState;
    long: MemoryScopeState;
  };
};

export type SessionMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
};
