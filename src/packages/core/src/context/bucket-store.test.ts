import { describe, expect, test } from "bun:test";
import type { ContextPutRequest } from "@atom-neo/shared";
import { BucketStore } from "./bucket-store";

function putRequest(overrides: Partial<ContextPutRequest> = {}): ContextPutRequest {
  return {
    scope: "session",
    owner: { sessionId: "s1" },
    entry: {
      key: "history",
      source: "test",
      channel: "runtime",
      trust: "trusted",
      priority: 1,
      content: "hello",
    },
    ...overrides,
  };
}

describe("BucketStore", () => {
  test("stores entries once per bucket and increments revisions only on change", () => {
    const store = new BucketStore();
    const first = store.put(putRequest());
    expect(store.put(putRequest())).toBe(first);
    const changed = store.put(putRequest({ entry: { ...putRequest().entry, content: "updated" } }));

    expect(first.revision).toBe(1);
    expect(changed.revision).toBe(2);
    expect(store.get("session", { sessionId: "s1" }, "history")).toBe(changed);
    expect(store.size).toBe(1);
    expect(store.inspect({ sessionId: "s1" })[0]?.entries.size).toBe(1);
    expect(store.inspect({ sessionId: "s2" })).toHaveLength(0);
  });

  test("removes empty buckets after entry removal", () => {
    const store = new BucketStore();
    store.put(putRequest());
    expect(store.remove("session", { sessionId: "s1" }, "missing")).toBe(false);
    expect(store.remove("session", { sessionId: "s1" }, "history")).toBe(true);
    expect(store.size).toBe(0);
  });

  test("honours expireOn before expiring and leases before disposing", () => {
    const store = new BucketStore();
    store.put(putRequest({ lifecycle: { expireOn: ["topic.changed"] } }));
    const bucketId = store.inspect()[0]!.id;

    expect(store.expireScope("session", { sessionId: "s1" }, "session.closed")).toBe(0);
    store.lease([bucketId]);
    expect(store.expireScope("session", { sessionId: "s1" }, "topic.changed")).toBe(1);
    expect(store.disposeExpired()).toBe(0);
    expect(store.leaseCount(bucketId)).toBe(1);
    store.releaseLease(bucketId);
    expect(store.disposeExpired()).toBe(1);
    expect(store.size).toBe(0);
  });

  test("consumes only matching entry revisions", () => {
    const store = new BucketStore();
    store.put(putRequest({ entry: { ...putRequest().entry, consumeOnCommit: true } }));
    const bucketId = store.inspect()[0]!.id;

    expect(store.removeConsumeOnCommit(bucketId, "history", 2, 1)).toBe(false);
    expect(store.removeConsumeOnCommit(bucketId, "history", 1, 1)).toBe(true);
    expect(store.size).toBe(1);
    expect(store.disposeExpired()).toBe(1);
    expect(store.size).toBe(0);
  });

  test("sweeps entry and bucket TTLs", () => {
    const store = new BucketStore();
    store.put(putRequest({ entry: { ...putRequest().entry, key: "expired", expiresAt: 5 } }));
    store.put(putRequest({ entry: { ...putRequest().entry, key: "keep" } }));
    expect(store.sweepExpired(5)).toBe(0);
    expect(store.get("session", { sessionId: "s1" }, "expired")).toBeUndefined();
    expect(store.get("session", { sessionId: "s1" }, "keep")).toBeDefined();

    store.put(putRequest({ scope: "task", owner: { taskId: "t1" }, lifecycle: { expiresAt: 5 } }));
    expect(store.sweepExpired(5)).toBe(1);
    expect(store.disposeExpired()).toBe(1);
    expect(store.size).toBe(1);
  });

  test("deletes matching buckets, leases and clears state", () => {
    const store = new BucketStore();
    store.put(putRequest());
    store.put(putRequest({ scope: "task", owner: { taskId: "t1" } }));
    const sessionId = store.inspect({ sessionId: "s1" })[0]!.id;
    store.lease([sessionId]);

    store.deleteBuckets(bucket => bucket.owner.sessionId === "s1");
    expect(store.inspect()).toHaveLength(1);
    store.clear();
    expect(store.size).toBe(0);
  });
});
