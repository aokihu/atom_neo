import { SessionContext } from "./context";

export class SessionStore {
  #sessions = new Map<string, SessionContext>();
  #maxSessions: number;
  #insertionOrder: string[] = [];

  constructor(maxSessions = 1000) {
    this.#maxSessions = maxSessions;
  }

  get(sessionId: string): SessionContext {
    let session = this.#sessions.get(sessionId);
    if (!session) {
      session = new SessionContext(sessionId);
      this.#sessions.set(sessionId, session);
      this.#insertionOrder.push(sessionId);

      if (this.#sessions.size > this.#maxSessions) {
        const oldest = this.#insertionOrder.shift()!;
        this.#sessions.delete(oldest!);
        this.#onEvict?.(oldest);
      }
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
