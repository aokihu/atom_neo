import { SessionContext } from "./context";

type LogFn = (msg: string, ctx?: Record<string, unknown>) => void;

export class SessionStore {
  #sessions = new Map<string, SessionContext>();
  #maxSessions: number;
  #lastAccess = new Map<string, number>();
  #idleTtlMs: number;
  #log: LogFn | null;
  #onCreated?: (sessionId: string) => void;
  #onClosed?: (sessionId: string) => void;

  constructor(maxSessions = 1000, log?: LogFn, idleTtlMs = 30 * 60_000) {
    this.#maxSessions = maxSessions;
    this.#log = log ?? null;
    this.#idleTtlMs = idleTtlMs;
  }

  get(sessionId: string): SessionContext {
    this.sweepIdle();
    let session = this.#sessions.get(sessionId);
    if (session) {
      this.#recordAccess(sessionId);
      this.#log?.("session-store get", { sid: sessionId, op: "HIT", size: this.#sessions.size });
      return session;
    }

    session = new SessionContext(sessionId);
    this.#sessions.set(sessionId, session);
    this.#recordAccess(sessionId);
    this.#log?.("session-store get", { sid: sessionId, op: "MISS", size: this.#sessions.size });
    this.#onCreated?.(sessionId);

    if (this.#sessions.size > this.#maxSessions) {
      const oldest = this.#lastAccess.keys().next().value!;
      this.#log?.("session-store evict", { sid: oldest, size: this.#sessions.size });
      this.#sessions.delete(oldest);
      this.#lastAccess.delete(oldest);
      this.#onClosed?.(oldest);
    }
    return session;
  }

  has(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  delete(sessionId: string): void {
    if (!this.#sessions.delete(sessionId)) return;
    this.#lastAccess.delete(sessionId);
    this.#onClosed?.(sessionId);
  }

  touch(sessionId: string): void {
    if (this.#sessions.has(sessionId)) this.#recordAccess(sessionId);
  }

  sweepIdle(now = Date.now()): string[] {
    if (this.#idleTtlMs <= 0) return [];
    const closed: string[] = [];
    for (const [sessionId, lastAccess] of this.#lastAccess) {
      if (now - lastAccess < this.#idleTtlMs) continue;
      this.delete(sessionId);
      closed.push(sessionId);
    }
    return closed;
  }

  get size(): number {
    return this.#sessions.size;
  }

  onCreated(handler: (sessionId: string) => void): void {
    this.#onCreated = handler;
  }

  onClosed(handler: (sessionId: string) => void): void {
    this.#onClosed = handler;
  }

  #recordAccess(sessionId: string): void {
    this.#lastAccess.delete(sessionId);
    this.#lastAccess.set(sessionId, Date.now());
  }
}
