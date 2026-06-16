import type {
  SessionMessage,
  ToolResultEntry,
  InferenceFact,
  ToolContext,
  ScopeState,
  MemoryScopeState,
  ContinuationContext,
} from "@atom-neo/shared";

export type TokenUsage = { total: number };

export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
};

export class SessionContext {
  readonly sessionId: string;

  // Transient per-request fields (set/cleared within a single task chain)
  evaluatorSuggestion?: string;
  upgradeModel?: boolean;
  pendingPrediction?: any;
  conversationSummary?: string;
  pendingCompressRatio?: number;
  compressing: boolean = false;
  compressRetry: number = 0;
  compressRatio: number = 0;

  #messages: SessionMessage[] = [];

  replaceEarlyMessages(keep: number): number {
    const removed = Math.max(0, this.#messages.length - keep);
    this.#messages = this.#messages.slice(-keep);
    return removed;
  }
  #inferenceFacts: InferenceFact[] = [];
  #toolContext: ToolContext = { mode: "idle", results: [] };
  #memoryScopes: MemoryScopeState = {
    core: { status: "idle", query: "" },
    short: { status: "idle", query: "" },
    long: { status: "idle", query: "" },
  };
  #continuationContext: ContinuationContext | null = null;
  #tokenUsage: TokenUsage = { total: 0 };
  #chainDepth: number = 0;
  #todoState: TodoItem[] = [];
  #currentTopic: string | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  #lastSafeMsgCount: number = 0;

  get lastSafeMsgCount(): number { return this.#lastSafeMsgCount; }

  markSafeMessageCount(): void {
    this.#lastSafeMsgCount = this.#messages.length;
  }

  get chainDepth(): number { return this.#chainDepth; }
  incrementChainDepth(): void { this.#chainDepth++; }
  resetChainDepth(): void { this.#chainDepth = 0; }

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

  addToolResult(result: ToolResultEntry): void {
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

  get tokenUsage(): Readonly<TokenUsage> {
    return this.#tokenUsage;
  }

  addTokenUsage(total: number): void {
    this.#tokenUsage.total += total;
  }

  get todoState(): readonly TodoItem[] {
    return this.#todoState;
  }

  setTodoState(items: TodoItem[]): void {
    this.#todoState = items;
  }

  get currentTopic(): string | null {
    return this.#currentTopic;
  }

  resetForNewTopic(topic: string): void {
    this.#currentTopic = topic || null;
    this.#todoState = [];
    this.#chainDepth = 0;
    this.#toolContext = { mode: "idle", results: [] };
    this.#continuationContext = null;
    this.evaluatorSuggestion = undefined;
    this.upgradeModel = undefined;
    this.conversationSummary = undefined;
    (this as any).postCheckGuidance = undefined;
  }

  toJSON(): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      messageCount: this.#messages.length,
      inferenceFactCount: this.#inferenceFacts.length,
      toolMode: this.#toolContext.mode,
      memoryScopes: this.#memoryScopes,
      hasContinuation: this.#continuationContext !== null,
      tokenUsage: this.#tokenUsage,
    };
  }
}
