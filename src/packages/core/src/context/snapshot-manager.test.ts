import { describe, expect, test } from "bun:test";
import type { ContextPutRequest } from "@atom-neo/shared";
import { BucketStore } from "./bucket-store";
import { SnapshotManager } from "./snapshot-manager";

function putRequest(overrides: Partial<ContextPutRequest> = {}): ContextPutRequest {
  return {
    scope: "session",
    owner: { sessionId: "s1" },
    entry: {
      key: "history",
      source: "test",
      channel: "messages",
      trust: "untrusted",
      priority: 1,
      content: [{ role: "user", content: "hello" }],
    },
    ...overrides,
  };
}

function createManager(options: { snapshotTtlMs?: number } = {}) {
  const buckets = new BucketStore();
  const manager = new SnapshotManager(buckets, options);
  return { buckets, manager };
}

describe("SnapshotManager", () => {
  test("creates an immutable inspectable state without internal fields", () => {
    const { buckets, manager } = createManager();
    buckets.put(putRequest());
    buckets.put(putRequest({ entry: { ...putRequest().entry, key: "hint", consumeOnCommit: true } }));

    const snapshot = manager.createSnapshot({ sessionId: "s1", inputBudget: 100 });
    const state = manager.inspect(snapshot.id)!;

    expect(Object.keys(state)).toEqual([
      "id", "status", "createdAt", "owner", "refs", "receipts", "manifest",
      "estimatedTokens", "inputBudget", "prefixHash",
    ]);
    expect(state.owner).toEqual({ sessionId: "s1" });
    expect(state.refs).toHaveLength(2);
    expect(state.receipts).toHaveLength(1);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.refs[0])).toBe(true);
    expect(manager.inspect("missing")).toBeUndefined();
  });

  test("commits matching revisions once and releases leases", () => {
    const { buckets, manager } = createManager();
    buckets.put(putRequest({ entry: { ...putRequest().entry, key: "once", consumeOnCommit: true } }));
    const snapshot = manager.createSnapshot({ sessionId: "s1" });

    expect(manager.commit(snapshot.id)).toBe(1);
    expect(manager.commit(snapshot.id)).toBe(0);
    expect(manager.release(snapshot.id)).toBe(false);
    expect(manager.inspect(snapshot.id)?.status).toBe("committed");
    expect(buckets.size).toBe(0);
  });

  test("does not consume a newer revision and keeps release idempotent", () => {
    const { buckets, manager } = createManager();
    buckets.put(putRequest({ entry: { ...putRequest().entry, key: "once", consumeOnCommit: true } }));
    const snapshot = manager.createSnapshot({ sessionId: "s1" });
    buckets.remove("session", { sessionId: "s1" }, "once");
    buckets.put(putRequest({ entry: { ...putRequest().entry, key: "once", consumeOnCommit: true } }));

    expect(manager.commit(snapshot.id)).toBe(0);
    expect(buckets.get("session", { sessionId: "s1" }, "once")).toBeDefined();
    expect(manager.release(snapshot.id)).toBe(false);
  });

  test("keeps expired buckets leased until the last snapshot is released", () => {
    const { buckets, manager } = createManager();
    buckets.put(putRequest());
    const first = manager.createSnapshot({ sessionId: "s1" });
    const second = manager.createSnapshot({ sessionId: "s1" });

    expect(buckets.expireScope("session", { sessionId: "s1" }, "session.closed")).toBe(1);
    expect(manager.release(first.id)).toBe(true);
    expect(buckets.size).toBe(1);
    expect(manager.release(second.id)).toBe(true);
    expect(buckets.size).toBe(0);
  });

  test("releases snapshots by owner filter", () => {
    const { buckets, manager } = createManager();
    buckets.put(putRequest({ scope: "topic", owner: { sessionId: "s1", topicId: "t1" } }));
    const snapshot = manager.createSnapshot({ sessionId: "s1", topicId: "t1" });

    manager.releaseByOwner({ sessionId: "s1", topicId: "t2" });
    expect(manager.inspect(snapshot.id)?.status).toBe("active");
    manager.releaseByOwner({ sessionId: "s1" });
    expect(manager.inspect(snapshot.id)?.status).toBe("released");
  });

  test("releases and deletes snapshots after the safety TTL", () => {
    const { buckets, manager } = createManager({ snapshotTtlMs: 1 });
    buckets.put(putRequest());
    const snapshot = manager.createSnapshot({ sessionId: "s1" });

    manager.sweepExpired(Date.now() + 2);
    expect(manager.inspect(snapshot.id)).toBeUndefined();
    expect(manager.size).toBe(0);
    expect(buckets.size).toBe(1);
  });
});
