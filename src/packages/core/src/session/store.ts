import { SessionContext } from "./context";

type LogFn = (msg: string, ctx?: Record<string, unknown>) => void;

export class SessionStore {
  #sessions = new Map<string, SessionContext>();
  #maxSessions: number;
  #insertionOrder: string[] = [];
  #log: LogFn | null;

  constructor(maxSessions = 1000, log?: LogFn) {
    this.#maxSessions = maxSessions;
    this.#log = log ?? null;
  }

  get(sessionId: string): SessionContext {
    let session = this.#sessions.get(sessionId);
    if (session) {
      this.#log?.("session-store get", { sid: sessionId, op: "HIT", size: this.#sessions.size });
      return session;
    }

    session = new SessionContext(sessionId);
    this.#sessions.set(sessionId, session);
    this.#insertionOrder.push(sessionId);
    this.#log?.("session-store get", { sid: sessionId, op: "MISS", size: this.#sessions.size });

    if (this.#sessions.size > this.#maxSessions) {
      const oldest = this.#insertionOrder.shift()!;
      this.#log?.("session-store evict", { sid: oldest, size: this.#sessions.size });
      this.#sessions.delete(oldest!);
      this.#onEvict?.(oldest);
    }
    return session;
  }

  has(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  delete(sessionId: string): void {
    this.#sessions.delete(sessionId);
    const idx = this.#insertionOrder.indexOf(sessionId);
    if (idx >= 0) this.#insertionOrder.splice(idx, 1);
  }

  get size(): number {
    return this.#sessions.size;
  }

  #onEvict?: (sessionId: string) => void;

  onEvict(handler: (sessionId: string) => void): void {
    this.#onEvict = handler;
  }
}
