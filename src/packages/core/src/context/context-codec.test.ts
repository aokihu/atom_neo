import { describe, expect, test } from "bun:test";
import type { ContextEntry } from "@atom-neo/shared";
import {
  createBucketId,
  createContextId,
  deepFreeze,
  expireBucket,
  filterMatchesOwner,
  freezeContent,
  pickOwner,
  sameEntry,
} from "./context-codec";
import type { MutableBucket } from "./context-types";
import { DEFAULT_EXPIRE_ON } from "./context-types";

function entry(overrides: Partial<ContextEntry> = {}): ContextEntry {
  return {
    key: "key",
    source: "test",
    channel: "runtime",
    trust: "trusted",
    priority: 1,
    revision: 1,
    content: "value",
    ...overrides,
  };
}

describe("context-codec", () => {
  test("encodes bucket and context ids deterministically", () => {
    expect(createBucketId("session", {})).toBe("session:-:-:-:-:-");
    expect(createBucketId("task", {
      workspaceId: "/ws",
      sessionId: "s 1",
      topicId: "t/1",
      taskId: "task-1",
      stepId: "step:1",
    })).toBe("task:%2Fws:s%201:t%2F1:task-1:step%3A1");
    expect(createContextId("session:-:s1:-:-:-", "a/b c")).toBe("session:-:s1:-:-:-/a%2Fb%20c");
  });

  test("filters owner matches in both directions", () => {
    expect(filterMatchesOwner({ sessionId: "s1" }, { sessionId: "s1", taskId: "t1" })).toBe(true);
    expect(filterMatchesOwner({ sessionId: "s1", taskId: "t1" }, { sessionId: "s1" })).toBe(false);
    expect(filterMatchesOwner({ sessionId: undefined }, {})).toBe(true);
    expect(filterMatchesOwner({ sessionId: "s1" }, { sessionId: "s2" })).toBe(false);
  });

  test("picks only defined owner fields", () => {
    expect(pickOwner({ sessionId: "s1", taskId: "t1" })).toEqual({ sessionId: "s1", taskId: "t1" });
    expect(pickOwner({ sessionId: "", taskId: undefined })).toEqual({});
  });

  test("compares entries ignoring revision only", () => {
    const current = entry({ revision: 3 });
    const { revision: _, ...withoutRevision } = current;
    expect(sameEntry(current, withoutRevision)).toBe(true);
    expect(sameEntry(current, { ...withoutRevision, content: "changed" })).toBe(false);
  });

  test("freezes structured clones and expires buckets", () => {
    const source = { nested: { value: "original" } };
    const frozen = freezeContent(source);
    source.nested.value = "mutated";
    expect(frozen).toEqual({ nested: { value: "original" } });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
    expect(deepFreeze({ child: {} })).toEqual({ child: {} });

    const bucket: MutableBucket = {
      id: "session:-:-:-:-:-",
      scope: "session",
      owner: {},
      lifecycle: { state: "active", createdAt: 1, updatedAt: 1, expireOn: DEFAULT_EXPIRE_ON.session },
      entries: new Map(),
      revisions: new Map(),
    };
    expireBucket(bucket, "ttl.expired", 10);
    expect(bucket.lifecycle).toMatchObject({
      state: "expired",
      updatedAt: 10,
      expiredAt: 10,
      expiredReason: "ttl.expired",
    });
  });
});
