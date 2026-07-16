import type {
  SessionMessage,
  ToolResultEntry,
  InferenceFact,
  ToolContext,
  ScopeState,
  MemoryScopeState,
  ContinuationContext,
} from "@atom-neo/shared";
import type {
  PersistedSessionState,
  PersistedSessionStatus,
  SessionArchiveState,
  SessionCheckpointReason,
} from "./types";

export type TokenUsage = { total: number };

export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
};

export function hasActiveTodos(todos?: readonly TodoItem[]): boolean {
  return todos?.some(todo => todo.status === "pending" || todo.status === "in_progress") ?? false;
}

export type TodoContinuationDecision = "continue" | "complete" | "limit_reached";

export const decideTodoContinuation = (
  todos: readonly TodoItem[] | undefined,
  chainDepth: number,
  maxChainDepth: number,
): TodoContinuationDecision => {
  if (!hasActiveTodos(todos)) return "complete";
  return chainDepth >= maxChainDepth ? "limit_reached" : "continue";
};

export class SessionContext {
  readonly sessionId: string;
  readonly createdAt: number;

  #pendingPrediction?: any;

  get pendingPrediction(): any { return this.#pendingPrediction; }
  set pendingPrediction(value: any) {
    this.#pendingPrediction = value;
  }
  pendingCompressRatio?: number;
  compressing: boolean = false;
  compressRetry: number = 0;
  compressRatio: number = 0;

  #messages: SessionMessage[] = [];
  #nextMessageSeq: number = 1;

  #inferenceFacts: InferenceFact[] = [];
  #toolContext: ToolContext = { mode: "idle", results: [] };
  #memoryScopes: MemoryScopeState = {
    core: { status: "idle", query: "" },
    short: { status: "idle", query: "" },
    long: { status: "idle", query: "" },
  };
  #continuationContext: ContinuationContext | null = null;
  #tokenUsage: TokenUsage = { total: 0 };
  #contextTokens: number = 0;
  #chainDepth: number = 0;
  #originalSource?: string;
  #todoState: TodoItem[] = [];
  #currentTopic: string | null = null;
  #postCheckFingerprints: string[] = [];

  constructor(sessionId: string, createdAt = Date.now()) {
    this.sessionId = sessionId;
    this.createdAt = createdAt;
  }

  #lastSafeMsgCount: number = 0;

  get lastSafeMsgCount(): number { return this.#lastSafeMsgCount; }

  markSafeMessageCount(): void {
    this.#lastSafeMsgCount = this.#messages.length;
  }

  get chainDepth(): number { return this.#chainDepth; }
  incrementChainDepth(): void { this.#chainDepth++; }
  setChainDepth(depth: number): void { this.#chainDepth = depth; }
  resetChainDepth(): void { this.#chainDepth = 0; }

  get originalSource(): string | undefined { return this.#originalSource; }
  set originalSource(v: string | undefined) { this.#originalSource = v; }

  get messages(): readonly SessionMessage[] {
    return this.#messages;
  }

  addMessage(msg: SessionMessage): void {
    const seq = msg.seq ?? this.#nextMessageSeq;
    this.#messages.push({ ...msg, seq });
    this.#nextMessageSeq = Math.max(this.#nextMessageSeq, seq + 1);
  }

  removeMessages(seqs: readonly number[]): number {
    const selected = new Set(seqs);
    const before = this.#messages.length;
    this.#messages = this.#messages.filter(message => message.seq === undefined || !selected.has(message.seq));
    this.#lastSafeMsgCount = Math.min(this.#lastSafeMsgCount, this.#messages.length);
    return before - this.#messages.length;
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

  get contextTokens(): number {
    return this.#contextTokens;
  }

  setContextTokens(total: number): void {
    this.#contextTokens = total;
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

  get postCheckFingerprints(): readonly string[] {
    return this.#postCheckFingerprints;
  }

  addPostCheckFingerprint(fp: string): void {
    this.#postCheckFingerprints.push(fp);
  }

  resetForNewTopic(topic: string): void {
    this.#currentTopic = topic || null;
    this.#todoState = [];
    this.#chainDepth = 0;
    this.#toolContext = { mode: "idle", results: [] };
    this.#continuationContext = null;
    this.#postCheckFingerprints = [];
  }

  exportState(params: {
    checkpointRevision: number;
    status: PersistedSessionStatus;
    archives: SessionArchiveState;
    reason?: SessionCheckpointReason;
  }): PersistedSessionState {
    const now = Date.now();
    const closed = params.status !== "active";
    const ended = params.status === "completed" || params.status === "failed";
    return {
      schemaVersion: 1,
      checkpointRevision: params.checkpointRevision,
      sessionId: this.sessionId,
      status: params.status,
      createdAt: this.createdAt,
      updatedAt: now,
      ...(closed ? { closedAt: now } : {}),
      ...(ended ? { endedAt: now } : {}),
      ...(params.reason ? { closeReason: params.reason } : {}),
      currentTopic: this.#currentTopic,
      chainDepth: this.#chainDepth,
      todoState: structuredClone(this.#todoState),
      continuationContext: this.#continuationContext ? { ...this.#continuationContext } : null,
      inferenceFacts: structuredClone(this.#inferenceFacts),
      tokenUsage: { ...this.#tokenUsage },
      contextTokens: this.#contextTokens,
      nextMessageSeq: this.#nextMessageSeq,
      archives: { ...params.archives },
    };
  }

  static restore(state: PersistedSessionState, messages: readonly SessionMessage[]): SessionContext {
    const session = new SessionContext(state.sessionId, state.createdAt);
    for (const message of messages) session.addMessage(message);
    session.#nextMessageSeq = Math.max(
      state.nextMessageSeq,
      ...messages.map(message => (message.seq ?? 0) + 1),
    );
    session.#inferenceFacts = structuredClone(state.inferenceFacts ?? []);
    session.#continuationContext = state.continuationContext ? { ...state.continuationContext } : null;
    session.#tokenUsage = { ...state.tokenUsage };
    session.#contextTokens = state.contextTokens ?? 0;
    session.#chainDepth = state.chainDepth ?? 0;
    session.#todoState = structuredClone(state.todoState ?? []);
    session.#currentTopic = state.currentTopic ?? null;
    session.#lastSafeMsgCount = session.#messages.length;
    return session;
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
      nextMessageSeq: this.#nextMessageSeq,
    };
  }
}
