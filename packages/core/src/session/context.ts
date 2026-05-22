import type { SessionMessage, ToolResult } from "@atom-neo/shared";

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

export class SessionContext {
  readonly sessionId: string;

  #messages: SessionMessage[] = [];
  #inferenceFacts: InferenceFact[] = [];
  #toolContext: ToolContext = { mode: "idle", results: [] };
  #memoryScopes: MemoryScopeState = {
    core: { status: "idle", query: "" },
    short: { status: "idle", query: "" },
    long: { status: "idle", query: "" },
  };
  #continuationContext: ContinuationContext | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  get messages(): readonly SessionMessage[] {
    return this.#messages;
  }

  addMessage(msg: SessionMessage): void {
    this.#messages.push(msg);
  }

  get inferenceFacts(): readonly InferenceFact[] {
    return this.#inferenceFacts;
  }

  setInferenceFacts(facts: InferenceFact[]): void {
    this.#inferenceFacts = facts;
  }

  addInferenceFact(fact: InferenceFact): void {
    this.#inferenceFacts.push(fact);
  }

  get toolContext(): Readonly<ToolContext> {
    return this.#toolContext;
  }

  setToolMode(mode: ToolContext["mode"]): void {
    this.#toolContext.mode = mode;
  }

  addToolResult(result: ToolResult): void {
    this.#toolContext.results.push(result);
  }

  get memoryScopes(): Readonly<MemoryScopeState> {
    return this.#memoryScopes;
  }

  setMemoryScopeStatus(
    scope: keyof MemoryScopeState,
    status: ScopeState["status"],
    query: string = "",
  ): void {
    this.#memoryScopes[scope] = { status, query };
  }

  resetMemoryScopes(): void {
    this.#memoryScopes = {
      core: { status: "idle", query: "" },
      short: { status: "idle", query: "" },
      long: { status: "idle", query: "" },
    };
  }

  get continuationContext(): Readonly<ContinuationContext> | null {
    return this.#continuationContext;
  }

  setContinuationContext(ctx: ContinuationContext): void {
    this.#continuationContext = ctx;
  }

  clearContinuationContext(): void {
    this.#continuationContext = null;
  }

  toJSON(): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      messageCount: this.#messages.length,
      inferenceFactCount: this.#inferenceFacts.length,
      toolMode: this.#toolContext.mode,
      memoryScopes: this.#memoryScopes,
      hasContinuation: this.#continuationContext !== null,
    };
  }
}
