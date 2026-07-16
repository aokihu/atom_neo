import { SessionContext } from "./context";
import type { SessionPersistenceService } from "./persistence-service";
import type { SessionCheckpointReason } from "./types";

type LogFn = (msg: string, ctx?: Record<string, unknown>) => void;

export class SessionStore {
  #sessions = new Map<string, SessionContext>();
  #maxSessions: number;
  #lastAccess = new Map<string, number>();
  #leases = new Map<string, number>();
  #taskLeases = new Map<string, string>();
  #idleTtlMs: number;
  #log: LogFn | null;
  #onCreated?: (sessionId: string) => void;
  #onClosed?: (sessionId: string) => void;
  #persistence?: SessionPersistenceService;

  constructor(
    maxSessions = 1000,
    log?: LogFn,
    idleTtlMs = 30 * 60_000,
    persistence?: SessionPersistenceService,
  ) {
    this.#maxSessions = maxSessions;
    this.#log = log ?? null;
    this.#idleTtlMs = idleTtlMs;
    this.#persistence = persistence;
  }

  get(sessionId: string): SessionContext {
    const loaded = this.load(sessionId);
    if (loaded) return loaded;

    const session = new SessionContext(sessionId);
    this.#sessions.set(sessionId, session);
    this.#recordAccess(sessionId);
    this.#log?.("session-store get", { sid: sessionId, op: "MISS", size: this.#sessions.size });
    this.#onCreated?.(sessionId);
    this.#evictOverflow(sessionId);
    return session;
  }

  load(sessionId: string): SessionContext | null {
    this.sweepIdle();
    const session = this.#sessions.get(sessionId);
    if (session) {
      this.#recordAccess(sessionId);
      this.#log?.("session-store get", { sid: sessionId, op: "HIT", size: this.#sessions.size });
      return session;
    }

    const restoredSession = this.#persistence?.restore(sessionId);
    if (!restoredSession) return null;
    this.#sessions.set(sessionId, restoredSession);
    this.#recordAccess(sessionId);
    this.#log?.("session-store get", { sid: sessionId, op: "RESTORE", size: this.#sessions.size });
    this.#evictOverflow(sessionId);
    return restoredSession;
  }

  has(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  delete(sessionId: string): boolean {
    if (this.isActive(sessionId)) return false;
    const existed = this.#sessions.delete(sessionId);
    this.#lastAccess.delete(sessionId);
    this.#leases.delete(sessionId);
    this.#persistence?.remove(sessionId);
    if (existed) this.#onClosed?.(sessionId);
    return true;
  }

  save(sessionId: string, reason: SessionCheckpointReason): boolean {
    const session = this.#sessions.get(sessionId);
    if (!session || !this.#persistence) return Boolean(session);
    try {
      this.#persistence.checkpoint(session, reason);
      return true;
    } catch (error) {
      this.#log?.("session-store save failed", { sid: sessionId, reason, error: String(error) });
      return false;
    }
  }

  checkpointUserMessage(sessionId: string, content: string): boolean {
    const session = this.get(sessionId);
    const previousChainDepth = session.chainDepth;
    const previousSource = session.originalSource;
    session.addMessage({ role: "user", content, timestamp: Date.now() });
    const seq = session.messages.at(-1)?.seq;
    session.resetChainDepth();
    session.originalSource = "external";
    if (this.save(sessionId, "message")) return true;
    if (seq !== undefined) session.removeMessages([seq]);
    session.setChainDepth(previousChainDepth);
    session.originalSource = previousSource;
    return false;
  }

  suspendAll(reason: Extract<SessionCheckpointReason, "shutdown"> = "shutdown"): string[] {
    const suspended: string[] = [];
    for (const sessionId of [...this.#sessions.keys()]) {
      if (this.#suspend(sessionId, reason)) suspended.push(sessionId);
    }
    return suspended;
  }

  touch(sessionId: string): void {
    if (this.#sessions.has(sessionId)) this.#recordAccess(sessionId);
  }

  acquire(sessionId: string): void {
    this.#leases.set(sessionId, (this.#leases.get(sessionId) ?? 0) + 1);
    this.touch(sessionId);
  }

  acquireTask(taskId: string, sessionId: string): void {
    if (this.#taskLeases.has(taskId)) return;
    this.#taskLeases.set(taskId, sessionId);
    this.acquire(sessionId);
  }

  release(sessionId: string): void {
    const count = (this.#leases.get(sessionId) ?? 0) - 1;
    if (count > 0) this.#leases.set(sessionId, count);
    else this.#leases.delete(sessionId);
    this.touch(sessionId);
  }

  releaseTask(taskId: string): void {
    const sessionId = this.#taskLeases.get(taskId);
    if (!sessionId) return;
    this.#taskLeases.delete(taskId);
    this.release(sessionId);
  }

  isActive(sessionId: string): boolean {
    return (this.#leases.get(sessionId) ?? 0) > 0;
  }

  sweepIdle(now = Date.now()): string[] {
    if (this.#idleTtlMs <= 0) return [];
    const closed: string[] = [];
    for (const [sessionId, lastAccess] of this.#lastAccess) {
      if (this.isActive(sessionId)) continue;
      if (now - lastAccess < this.#idleTtlMs) continue;
      if (this.#suspend(sessionId, "idle")) closed.push(sessionId);
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

  #suspend(sessionId: string, reason: Extract<SessionCheckpointReason, "idle" | "capacity" | "shutdown">): boolean {
    const session = this.#sessions.get(sessionId);
    if (!session || (reason !== "shutdown" && this.isActive(sessionId))) return false;
    if (this.#persistence) {
      try {
        this.#persistence.checkpoint(session, reason);
      } catch (error) {
        this.#log?.("session-store suspend failed", { sid: sessionId, reason, error: String(error) });
        return false;
      }
    }
    this.#sessions.delete(sessionId);
    this.#lastAccess.delete(sessionId);
    this.#leases.delete(sessionId);
    for (const [taskId, leasedSessionId] of this.#taskLeases) {
      if (leasedSessionId === sessionId) this.#taskLeases.delete(taskId);
    }
    this.#onClosed?.(sessionId);
    return true;
  }

  #recordAccess(sessionId: string): void {
    this.#lastAccess.delete(sessionId);
    this.#lastAccess.set(sessionId, Date.now());
  }

  #evictOverflow(currentSessionId: string): void {
    if (this.#sessions.size <= this.#maxSessions) return;
    const oldest = [...this.#lastAccess.keys()].find(id => id !== currentSessionId && !this.isActive(id));
    if (!oldest) return;
    this.#log?.("session-store evict", { sid: oldest, size: this.#sessions.size });
    this.#suspend(oldest, "capacity");
  }
}
