import { createHash } from "node:crypto";
import { contextRows } from "./test-helpers";
import { describe, expect, test } from "bun:test";
import { BusEvents, PipelineEventBus } from "@atom-neo/shared";
import type {
  ContextEntry,
  ContextPutRequest,
  ContextScope,
  FullEventMap,
} from "@atom-neo/shared";
import { ContextService } from "./context-service";

// Characterization for S12-C: bucket ids, entry revisions, snapshot state, persisted JSON,
// lease/dispose counts and lifecycle event effects. Timestamps are normalized to 0.

function createService(options: ConstructorParameters<typeof ContextService>[1] = {}) {
  const bus = new PipelineEventBus<FullEventMap>();
  const service = new ContextService(bus, { sweepIntervalMs: 0, ...options });
  service.start();
  return { bus, service };
}

function entry(key: string, overrides: Partial<Omit<ContextEntry, "revision">> = {}): Omit<ContextEntry, "revision"> {
  return {
    key,
    source: "test",
    channel: "runtime",
    trust: "trusted",
    priority: 1,
    content: key,
    ...overrides,
  };
}

function putRequest(
  scope: ContextScope,
  owner: ContextPutRequest["owner"],
  overrides: Partial<ContextPutRequest> = {},
): ContextPutRequest {
  return { scope, owner, entry: entry("value"), ...overrides };
}

describe("ContextService characterization", () => {
  test("locks bucket identities and lifecycle defaults per owner", () => {
    const { service } = createService();
    const owners: Array<[ContextScope, ContextPutRequest["owner"]]> = [
      ["system", {}],
      ["workspace", { workspaceId: "/ws/1" }],
      ["session", { workspaceId: "/ws", sessionId: "s 1" }],
      ["topic", { sessionId: "s1", topicId: "t/1" }],
      ["task", { sessionId: "s1", taskId: "task-1" }],
      ["step", { sessionId: "s1", taskId: "task-1", stepId: "step-1" }],
    ];
    for (const [index, [scope, owner]] of owners.entries()) {
      service.put({ scope, owner, entry: entry(`value-${index}`) });
    }

    expect(service.inspectBuckets().map(bucket => bucket.id)).toEqual([
      "system:-:-:-:-:-",
      "workspace:%2Fws%2F1:-:-:-:-",
      "session:%2Fws:s%201:-:-:-",
      "topic:-:s1:t%2F1:-:-",
      "task:-:s1:-:task-1:-",
      "step:-:s1:-:task-1:step-1",
    ]);
    const session = service.inspectBuckets({ sessionId: "s 1" })[0]!;
    expect(session.owner).toEqual({ workspaceId: "/ws", sessionId: "s 1" });
    expect(session.lifecycle.state).toBe("active");
    expect(session.lifecycle.expireOn).toEqual(["session.closed", "core.stopped"]);
    expect(session.lifecycle.expiredAt).toBeUndefined();
    expect(session.lifecycle.expiredReason).toBeUndefined();
    expect(session.lifecycle.createdAt).toBeNumber();
    service.stop();
  });

  test("keeps put idempotence, revision increments and empty-bucket removal", () => {
    const { service } = createService();
    const request = putRequest("session", { sessionId: "s1" }, { entry: entry("history", {
      channel: "messages",
      trust: "untrusted",
      content: [{ role: "user", content: "hello" }],
    }) });

    const first = service.put(request);
    const unchanged = service.put(request);
    const changed = service.put({ ...request, entry: { ...request.entry, content: [{ role: "user", content: "updated" }] } });

    expect(first.revision).toBe(1);
    expect(unchanged).toBe(first);
    expect(changed.revision).toBe(2);
    expect(service.get("session", { sessionId: "s1" }, "history")).toBe(changed);
    expect(service.remove("session", { sessionId: "s1" }, "missing")).toBe(false);
    expect(service.remove("session", { sessionId: "s1" }, "history")).toBe(true);
    expect(service.get("session", { sessionId: "s1" }, "history")).toBeUndefined();
    expect(service.bucketCount).toBe(0);
    service.stop();
  });

  test("locks snapshot refs, receipts, manifest and prefix hash", () => {
    const { service } = createService();
    service.put({ scope: "system", owner: {}, entry: entry("prompt", {
      source: "core", channel: "instructions", format: "text", pinned: true, priority: 100, content: "Rules",
    }) });
    service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("history", {
      source: "conversation", channel: "messages", trust: "untrusted", priority: 10,
      content: [{ role: "user", content: "hello" }],
    }) }));
    service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("hint", {
      source: "post-conversation", channel: "messages", trust: "untrusted", priority: 5,
      consumeOnCommit: true, content: "once",
    }) }));
    service.put(putRequest("task", { sessionId: "s1", taskId: "t1" }, { entry: entry("task-state", {
      source: "task-state", content: { todos: [] },
    }) }));

    const snapshot = service.createSnapshot({ sessionId: "s1", inputBudget: 1000 });
    const state = service.inspectSnapshot(snapshot.id)!;

    expect(Object.keys(snapshot)).toEqual(["id", "content"]);
    expect(state.id).toBe(snapshot.id);
    expect(state.status).toBe("active");
    expect(state.owner).toEqual({ sessionId: "s1" });
    expect(state.inputBudget).toBe(1000);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.refs)).toBe(true);
    expect(state.refs.map(ref => [ref[0], ref[1]])).toEqual([
      ["system:-:-:-:-:-/prompt", 1],
      ["session:-:s1:-:-:-/history", 1],
      ["session:-:s1:-:-:-/hint", 1],
    ]);
    for (const ref of state.refs) {
      expect(ref[2]).toMatch(/^[0-9a-f]{16}$/);
      expect(ref[3]).toBeGreaterThanOrEqual(1);
    }
    expect(state.receipts).toEqual([{
      id: "post-conversation:session:-:s1:-:-:-/hint:1",
      fragmentKey: "session:-:s1:-:-:-/hint",
      source: "post-conversation",
      revision: 1,
    }]);
    expect(state.manifest.map(item => [item.key, item.selected, item.retention, item.reason])).toEqual([
      ["system:-:-:-:-:-/prompt", true, "pinned", undefined],
      ["session:-:s1:-:-:-/history", true, "session", undefined],
      ["session:-:s1:-:-:-/hint", true, "once", undefined],
    ]);
    expect(state.estimatedTokens).toBe(state.manifest.reduce((total, item) => total + item.estimatedTokens, 0));
    expect(state.prefixHash).toBe(createHash("sha256").update(snapshot.content).digest("hex").slice(0, 16));
    expect(contextRows(snapshot).map(row => row.content)).toEqual(["hello", "once"]);
    expect(service.snapshotCount).toBe(1);
    service.stop();
  });

  test("applies snapshot budgets and records budgeted manifest entries", () => {
    const { service } = createService();
    service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("high", { priority: 10, content: "hello" }) }));
    service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("low", { priority: 1, content: "skipped" }) }));

    const snapshot = service.createSnapshot({ sessionId: "s1", inputBudget: 2 });
    const state = service.inspectSnapshot(snapshot.id)!;

    expect(state.inputBudget).toBe(2);
    expect(state.manifest.map(item => [item.key.split("/").at(-1), item.selected, item.reason])).toEqual([
      ["high", true, undefined],
      ["low", false, "budget"],
    ]);
    expect(state.refs.map(ref => ref[0])).toEqual(["session:-:s1:-:-:-/high"]);
    expect(contextRows(snapshot).map(row => row.content)).toEqual(["hello"]);
    service.stop();
  });

  test("commit consumes matching revisions and release disposes expired buckets", () => {
    const { service } = createService();
    service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("hint", {
      channel: "messages", trust: "untrusted", consumeOnCommit: true, content: "hint",
    }) }));
    service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("stable", { content: "stable" }) }));

    const snapshot = service.createSnapshot({ sessionId: "s1" });
    expect(service.expireScope("session", { sessionId: "s1" }, "session.closed")).toBe(1);
    expect(service.bucketCount).toBe(1);
    expect(service.inspectBuckets()[0]?.lifecycle.state).toBe("expired");
    expect(service.releaseSnapshot(snapshot.id)).toBe(true);
    expect(service.inspectSnapshot(snapshot.id)?.status).toBe("released");
    expect(service.releaseSnapshot(snapshot.id)).toBe(false);
    expect(service.commitSnapshot(snapshot.id)).toBe(0);
    expect(service.bucketCount).toBe(0);

    service.put(putRequest("session", { sessionId: "s2" }, { entry: entry("once", {
      channel: "messages", trust: "untrusted", consumeOnCommit: true, content: "once",
    }) }));
    const committed = service.createSnapshot({ sessionId: "s2" });
    expect(service.commitSnapshot(committed.id)).toBe(1);
    expect(service.commitSnapshot(committed.id)).toBe(0);
    expect(service.inspectSnapshot(committed.id)?.status).toBe("committed");
    expect(service.get("session", { sessionId: "s2" }, "once")).toBeUndefined();
    expect(service.bucketCount).toBe(0);
    service.stop();
  });

  test("does not consume a replacement revision captured by an older snapshot", () => {
    const { service } = createService();
    service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("hint", {
      channel: "messages", trust: "untrusted", consumeOnCommit: true, content: "old",
    }) }));
    const snapshot = service.createSnapshot({ sessionId: "s1" });
    service.remove("session", { sessionId: "s1" }, "hint");
    const replacement = service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("hint", {
      channel: "messages", trust: "untrusted", consumeOnCommit: true, content: "new",
    }) }));

    expect(replacement.revision).toBe(2);
    expect(service.commitSnapshot(snapshot.id)).toBe(0);
    expect(service.get("session", { sessionId: "s1" }, "hint")).toBe(replacement);
    service.stop();
  });

  test("keeps buckets leased until every snapshot releases them", () => {
    const { service } = createService();
    service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("history", {
      channel: "messages", trust: "untrusted",
    }) }));
    const first = service.createSnapshot({ sessionId: "s1" });
    const second = service.createSnapshot({ sessionId: "s1" });

    expect(service.expireScope("session", { sessionId: "s1" }, "session.closed")).toBe(1);
    expect(service.disposeExpired()).toBe(0);
    expect(service.releaseSnapshot(first.id)).toBe(true);
    expect(service.bucketCount).toBe(1);
    expect(service.releaseSnapshot(second.id)).toBe(true);
    expect(service.bucketCount).toBe(0);
    service.stop();
  });

  test("sweeps entry TTLs, bucket TTLs and abandoned snapshot TTLs", () => {
    const { service } = createService({ snapshotTtlMs: 1 });
    const now = Date.now();
    service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("expired-entry", {
      channel: "messages", trust: "untrusted", expiresAt: now - 1,
    }) }));
    service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("keep", {
      channel: "messages", trust: "untrusted",
    }) }));
    expect(service.sweepExpired(now)).toBe(0);
    expect(service.get("session", { sessionId: "s1" }, "expired-entry")).toBeUndefined();
    expect(service.get("session", { sessionId: "s1" }, "keep")).toBeDefined();

    const snapshot = service.createSnapshot({ sessionId: "s1" });
    service.put(putRequest("task", { sessionId: "s1", taskId: "t1" }, { lifecycle: { expiresAt: now - 1 } }));
    expect(service.sweepExpired(now)).toBe(1);
    expect(service.inspectBuckets().some(bucket => bucket.scope === "task")).toBe(false);

    expect(service.sweepExpired(now + 2)).toBe(0);
    expect(service.inspectSnapshot(snapshot.id)).toBeUndefined();
    expect(service.snapshotCount).toBe(0);
    expect(service.bucketCount).toBe(1);
    service.stop();
  });

  test("locks persisted session/topic JSON and restore filtering", () => {
    const first = createService();
    first.service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("history", {
      source: "conversation", channel: "messages", trust: "untrusted", priority: 10,
      content: [{ role: "user", content: "hello" }],
    }) }));
    first.service.put(putRequest("topic", { sessionId: "s1", topicId: "t1" }, { entry: entry("topic-history") }));
    first.service.put(putRequest("task", { sessionId: "s1", taskId: "task-1" }, { entry: entry("task-only") }));
    first.service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("once", { consumeOnCommit: true }) }));
    first.service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("expired-entry", { expiresAt: 1 }) }));
    first.service.put(putRequest("topic", { sessionId: "s1", topicId: "expired" }, {
      lifecycle: { expiresAt: 1 },
      entry: entry("expired-bucket"),
    }));

    const persisted = first.service.exportSessionState("s1", 7);
    expect(Object.keys(persisted)).toEqual(["schemaVersion", "checkpointRevision", "savedAt", "sessionId", "buckets"]);
    expect(Object.keys(persisted.buckets[0]!)).toEqual(["scope", "owner", "lifecycle", "entries"]);
    expect(Object.keys(persisted.buckets[0]!.entries[0]!)).toEqual([
      "key", "source", "channel", "trust", "priority", "content", "revision",
    ]);
    expect(JSON.parse(JSON.stringify({ ...persisted, savedAt: 0 }))).toEqual({
      schemaVersion: 1,
      checkpointRevision: 7,
      savedAt: 0,
      sessionId: "s1",
      buckets: [
        {
          scope: "session",
          owner: { sessionId: "s1" },
          lifecycle: { expireOn: ["session.closed", "core.stopped"] },
          entries: [{
            key: "history",
            source: "conversation",
            channel: "messages",
            trust: "untrusted",
            priority: 10,
            revision: 1,
            content: [{ role: "user", content: "hello" }],
          }],
        },
        {
          scope: "topic",
          owner: { sessionId: "s1", topicId: "t1" },
          lifecycle: { expireOn: ["topic.changed", "session.closed", "core.stopped"] },
          entries: [{
            key: "topic-history",
            source: "test",
            channel: "runtime",
            trust: "trusted",
            priority: 1,
            revision: 1,
            content: "topic-history",
          }],
        },
      ],
    });

    const second = createService();
    second.service.put(putRequest("session", { sessionId: "s1" }, { entry: entry("stale") }));
    second.service.put(putRequest("session", { sessionId: "s2" }, { entry: entry("other-session") }));
    expect(second.service.restoreSessionState(persisted)).toBe(2);
    expect(second.service.get("session", { sessionId: "s1" }, "stale")).toBeUndefined();
    expect(second.service.get("session", { sessionId: "s1" }, "history")?.content)
      .toEqual([{ role: "user", content: "hello" }]);
    expect(second.service.get("topic", { sessionId: "s1", topicId: "t1" }, "topic-history")).toBeDefined();
    expect(second.service.get("session", { sessionId: "s2" }, "other-session")).toBeDefined();
    first.service.stop();
    second.service.stop();
  });

  test("releases topic/task/session snapshots before expiring their buckets", () => {
    const topic = createService();
    topic.service.put(putRequest("topic", { sessionId: "s1", topicId: "t1" }));
    const topicSnapshot = topic.service.createSnapshot({ sessionId: "s1", topicId: "t1" });
    topic.bus.emit(BusEvents.Context.TopicChanged, { sessionId: "s1", previousTopicId: "t1", topicId: "t2" });
    expect(topic.service.inspectSnapshot(topicSnapshot.id)?.status).toBe("released");
    expect(topic.service.bucketCount).toBe(0);

    const task = createService();
    task.service.put(putRequest("task", { sessionId: "s1", taskId: "task-1" }));
    const taskSnapshot = task.service.createSnapshot({ sessionId: "s1", taskId: "task-1" });
    task.bus.emit(BusEvents.Task.Completed, { task: { id: "task-1" } as never, result: {} as never });
    expect(task.service.inspectSnapshot(taskSnapshot.id)?.status).toBe("released");
    expect(task.service.bucketCount).toBe(0);

    const session = createService();
    session.service.put(putRequest("session", { sessionId: "s1" }));
    const sessionSnapshot = session.service.createSnapshot({ sessionId: "s1" });
    session.bus.emit(BusEvents.Session.Closed, { sessionId: "s1" });
    expect(session.service.inspectSnapshot(sessionSnapshot.id)?.status).toBe("released");
    expect(session.service.bucketCount).toBe(0);

    topic.service.stop();
    task.service.stop();
    session.service.stop();
  });
});
