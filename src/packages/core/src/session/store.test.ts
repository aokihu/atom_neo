import { describe, test, expect, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { ContextService } from "../context/context-service";
import { SessionPersistenceService } from "./persistence-service";
import { SessionStore } from "./store";

describe("SessionStore", () => {
  test("creates session on first get", () => {
    const store = new SessionStore();
    const session = store.get("new-session");
    expect(session.sessionId).toBe("new-session");
    expect(store.size).toBe(1);
  });

  test("returns existing session on repeated get", () => {
    const store = new SessionStore();
    const s1 = store.get("same-session");
    s1.addMessage({ role: "user", content: "test", timestamp: 0 });

    const s2 = store.get("same-session");
    expect(s2.messages.length).toBe(1);
    expect(s1).toBe(s2);
  });

  test("loads without creating a missing session", () => {
    const created = mock(() => {});
    const store = new SessionStore();
    store.onCreated(created);

    expect(store.load("missing")).toBeNull();
    expect(store.size).toBe(0);
    expect(created).not.toHaveBeenCalled();
  });

  test("has checks existence", () => {
    const store = new SessionStore();
    expect(store.has("missing")).toBe(false);
    store.get("exists");
    expect(store.has("exists")).toBe(true);
  });

  test("deletes session", () => {
    const store = new SessionStore();
    store.get("tmp");
    expect(store.has("tmp")).toBe(true);

    store.delete("tmp");
    expect(store.has("tmp")).toBe(false);
    expect(store.size).toBe(0);
  });

  test("evicts oldest on overflow", () => {
    const store = new SessionStore(2);
    store.get("first");
    store.get("second");
    store.get("third");

    expect(store.has("first")).toBe(false);
    expect(store.has("second")).toBe(true);
    expect(store.has("third")).toBe(true);
    expect(store.size).toBe(2);
  });

  test("refreshes recency on get before LRU eviction", () => {
    const store = new SessionStore(2);
    store.get("first");
    store.get("second");
    store.get("first");
    store.get("third");

    expect(store.has("first")).toBe(true);
    expect(store.has("second")).toBe(false);
  });

  test("sweeps idle sessions", () => {
    const store = new SessionStore(10, undefined, 100);
    store.get("idle");

    const closed = store.sweepIdle(Date.now() + 101);

    expect(closed).toEqual(["idle"]);
    expect(store.has("idle")).toBe(false);
  });

  test("calls closed handler on eviction", () => {
    const handler = mock(() => {});
    const store = new SessionStore(1);
    store.onClosed(handler);

    store.get("first");
    store.get("second");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("first");
  });

  test("suspends before eviction and restores from disk", () => {
    const root = mkdtempSync(resolve(tmpdir(), "atom-store-"));
    const contextService = new ContextService(new PipelineEventBus<FullEventMap>(), { sweepIntervalMs: 0 });
    const persistence = new SessionPersistenceService(root, contextService);
    const first = new SessionStore(1, undefined, 0, persistence);
    first.get("one").addMessage({ role: "user", content: "persisted", timestamp: 1 });
    first.get("two");

    expect(first.has("one")).toBe(false);
    const second = new SessionStore(1, undefined, 0, persistence);
    expect(second.get("one").messages[0]?.content).toBe("persisted");
    rmSync(root, { recursive: true, force: true });
  });

  test("does not evict, sweep, or delete a leased session", () => {
    const store = new SessionStore(1, undefined, 100);
    store.get("active");
    store.acquireTask("task-1", "active");
    store.get("new");

    expect(store.has("active")).toBe(true);
    expect(store.sweepIdle(Date.now() + 101)).not.toContain("active");
    expect(store.delete("active")).toBe(false);

    store.releaseTask("task-1");
    expect(store.delete("active")).toBe(true);
  });

  test("evicts the next inactive session when the oldest is leased", () => {
    const store = new SessionStore(2);
    store.get("oldest");
    store.acquireTask("task-1", "oldest");
    store.get("second");
    store.get("third");

    expect(store.has("oldest")).toBe(true);
    expect(store.has("second")).toBe(false);
    expect(store.has("third")).toBe(true);
  });

  test("keeps a session in memory when eviction checkpoint fails", () => {
    const persistence = {
      restore: () => null,
      checkpoint: () => { throw new Error("disk full"); },
      remove: () => {},
    } as any;
    const store = new SessionStore(1, undefined, 0, persistence);
    store.get("first");
    store.get("second");

    expect(store.has("first")).toBe(true);
    expect(store.has("second")).toBe(true);
  });

  test("shutdown checkpoints leased sessions", () => {
    const checkpoint = mock(() => {});
    const persistence = { restore: () => null, checkpoint, remove: () => {} } as any;
    const store = new SessionStore(1, undefined, 0, persistence);
    store.get("active");
    store.acquireTask("task-1", "active");

    expect(store.suspendAll("shutdown")).toEqual(["active"]);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });

  test("keeps runtime state unchanged when a user-message checkpoint fails", () => {
    const persistence = {
      restore: () => null,
      checkpoint: () => { throw new Error("disk full"); },
      remove: () => {},
    } as any;
    const store = new SessionStore(1, undefined, 0, persistence);
    const session = store.get("active");
    session.incrementChainDepth();
    session.incrementChainDepth();
    session.originalSource = "internal";

    expect(store.checkpointUserMessage(session.sessionId, "rejected")).toBe(false);
    expect(session.messages).toHaveLength(0);
    expect(session.chainDepth).toBe(2);
    expect(session.originalSource).toBe("internal");
  });

  test("keeps a session in memory when shutdown checkpoint fails", () => {
    const persistence = {
      restore: () => null,
      checkpoint: () => { throw new Error("disk full"); },
      remove: () => {},
    } as any;
    const store = new SessionStore(1, undefined, 0, persistence);
    store.get("active");

    expect(store.suspendAll("shutdown")).toEqual([]);
    expect(store.has("active")).toBe(true);
  });
});
