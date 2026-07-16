import { isDeepStrictEqual } from "node:util";
import { BusEvents } from "@atom-neo/shared";
import type {
  ContextBucket,
  ContextEntry,
  ContextLifecycle,
  ContextLifecycleEvent,
  ContextOwner,
  ContextPutRequest,
  ContextScope,
  ContextSnapshot,
  ContextSnapshotRequest,
  ContextSnapshotState,
  FullEventMap,
  PipelineEventBus,
  SnapshotRecordRef,
} from "@atom-neo/shared";
import { compileContextSnapshot } from "./compiler";

type MutableBucket = {
  id: string;
  scope: ContextScope;
  owner: ContextOwner;
  lifecycle: ContextLifecycle;
  entries: Map<string, ContextEntry>;
  revisions: Map<string, number>;
};

type SnapshotRecord = {
  bucketId: string;
  entryKey: string;
  revision: number;
  consumeOnCommit: boolean;
};

type MutableSnapshotState = {
  id: string;
  status: ContextSnapshotState["status"];
  createdAt: number;
  owner: ContextOwner;
  refs: SnapshotRecordRef[];
  receipts: ContextSnapshotState["receipts"];
  manifest: ContextSnapshotState["manifest"];
  estimatedTokens: number;
  inputBudget: number;
  prefixHash: string;
  records: SnapshotRecord[];
  leasedBucketIds: string[];
};

export type PersistedContextBucket = {
  scope: Extract<ContextScope, "session" | "topic">;
  owner: ContextOwner;
  lifecycle: {
    expiresAt?: number;
    expireOn: readonly ContextLifecycleEvent[];
  };
  entries: ContextEntry[];
};

export type PersistedContextState = {
  schemaVersion: 1;
  checkpointRevision: number;
  savedAt: number;
  sessionId: string;
  buckets: PersistedContextBucket[];
};

const SCOPE_RETENTION: Record<ContextScope, "pinned" | "session" | "topic" | "task" | "step"> = {
  system: "pinned",
  workspace: "pinned",
  session: "session",
  topic: "topic",
  task: "task",
  step: "step",
};

const DEFAULT_EXPIRE_ON: Record<ContextScope, readonly ContextLifecycleEvent[]> = {
  system: ["core.stopped"],
  workspace: ["workspace.closed", "workspace.changed", "core.stopped"],
  session: ["session.closed", "core.stopped"],
  topic: ["topic.changed", "session.closed", "core.stopped"],
  task: ["task.completed", "task.failed", "topic.changed", "session.closed", "core.stopped"],
  step: ["step.completed", "task.completed", "task.failed", "topic.changed", "session.closed", "core.stopped"],
};

export class ContextService {
  #buckets = new Map<string, MutableBucket>();
  #snapshots = new Map<string, MutableSnapshotState>();
  #bucketLeases = new Map<string, number>();
  #unsubscribers: Array<() => void> = [];
  #sweepTimer?: ReturnType<typeof setInterval>;
  #started = false;

  constructor(
    private readonly bus: PipelineEventBus<FullEventMap>,
    private readonly options: {
      sweepIntervalMs?: number;
      snapshotTtlMs?: number;
    } = {},
  ) {}

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#unsubscribers.push(
      this.bus.on(BusEvents.Context.SnapshotCommit, ({ snapshotId }) => this.commitSnapshot(snapshotId)),
      this.bus.on(BusEvents.Context.SnapshotRelease, ({ snapshotId }) => this.releaseSnapshot(snapshotId)),
      this.bus.on(BusEvents.Context.CoreStopped, () => this.#expireBuckets(() => true, "core.stopped")),
      this.bus.on(BusEvents.Context.WorkspaceChanged, ({ workspaceId, previousWorkspaceId }) => {
        this.#expireBuckets(
          bucket => bucket.scope === "workspace"
            && (previousWorkspaceId
              ? bucket.owner.workspaceId === previousWorkspaceId
              : bucket.owner.workspaceId !== workspaceId),
          "workspace.changed",
        );
      }),
      this.bus.on(BusEvents.Context.WorkspaceClosed, ({ workspaceId }) => {
        this.expireScope("workspace", { workspaceId }, "workspace.closed");
      }),
      this.bus.on(BusEvents.Context.TopicChanged, event => this.#onTopicChanged(event)),
      this.bus.on(BusEvents.Context.StepCompleted, event => {
        this.expireScope("step", { taskId: event.taskId, stepId: event.stepId }, "step.completed");
      }),
      this.bus.on(BusEvents.Session.Closed, ({ sessionId }) => this.#onSessionClosed(sessionId)),
      this.bus.on(BusEvents.Task.Completed, ({ task }) => this.#onTaskEnded(task.id, "task.completed")),
      this.bus.on(BusEvents.Task.Failed, ({ task }) => this.#onTaskEnded(task.id, "task.failed")),
    );

    const interval = this.options.sweepIntervalMs ?? 60_000;
    if (interval > 0) {
      this.#sweepTimer = setInterval(() => this.sweepExpired(), interval);
      this.#sweepTimer.unref?.();
    }
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
    if (this.#sweepTimer) clearInterval(this.#sweepTimer);
    this.#sweepTimer = undefined;
    this.#buckets.clear();
    this.#snapshots.clear();
    this.#bucketLeases.clear();
  }

  put(request: ContextPutRequest): Readonly<ContextEntry> {
    if (request.entry.channel === "instructions" && request.entry.trust === "untrusted") {
      throw new Error(`Untrusted context cannot use the instructions channel: ${request.entry.key}`);
    }

    const now = Date.now();
    const owner = request.owner ?? {};
    const bucketId = createBucketId(request.scope, owner);
    let bucket = this.#buckets.get(bucketId);
    if (!bucket) {
      bucket = {
        id: bucketId,
        scope: request.scope,
        owner: { ...owner },
        lifecycle: {
          state: "active",
          createdAt: now,
          updatedAt: now,
          expiresAt: request.lifecycle?.expiresAt,
          expireOn: Object.freeze([...(request.lifecycle?.expireOn ?? DEFAULT_EXPIRE_ON[request.scope])]),
        },
        entries: new Map(),
        revisions: new Map(),
      };
      this.#buckets.set(bucketId, bucket);
    } else {
      bucket.lifecycle.state = "active";
      bucket.lifecycle.updatedAt = now;
      bucket.lifecycle.expiresAt = request.lifecycle?.expiresAt ?? bucket.lifecycle.expiresAt;
      if (request.lifecycle?.expireOn) {
        bucket.lifecycle.expireOn = Object.freeze([...request.lifecycle.expireOn]);
      }
      bucket.lifecycle.expiredAt = undefined;
      bucket.lifecycle.expiredReason = undefined;
    }

    const current = bucket.entries.get(request.entry.key);
    if (current && sameEntry(current, request.entry)) return current;

    const entry: ContextEntry = Object.freeze({
      ...request.entry,
      content: freezeContent(request.entry.content),
      revision: (bucket.revisions.get(request.entry.key) ?? 0) + 1,
    });
    bucket.entries.set(entry.key, entry);
    bucket.revisions.set(entry.key, entry.revision);
    return entry;
  }

  remove(scope: ContextScope, owner: ContextOwner, key: string): boolean {
    const bucket = this.#buckets.get(createBucketId(scope, owner));
    if (!bucket?.entries.delete(key)) return false;
    if (bucket.entries.size === 0) {
      expireBucket(bucket, "entries.empty", Date.now());
      this.disposeExpired();
    }
    return true;
  }

  get(scope: ContextScope, owner: ContextOwner, key: string): Readonly<ContextEntry> | undefined {
    return this.#buckets.get(createBucketId(scope, owner))?.entries.get(key);
  }

  createSnapshot(request: ContextSnapshotRequest): ContextSnapshot {
    const now = Date.now();
    this.sweepExpired(now);
    const selectedBuckets = [...this.#buckets.values()]
      .filter(bucket => bucket.lifecycle.state === "active" && ownerMatches(bucket.owner, request));
    const recordById = new Map<string, SnapshotRecord>();
    const fragments = selectedBuckets.flatMap(bucket => [...bucket.entries.values()]
      .filter(entry => entry.expiresAt === undefined || entry.expiresAt > now)
      .map(entry => {
        const contextId = createContextId(bucket.id, entry.key);
        recordById.set(contextId, {
          bucketId: bucket.id,
          entryKey: entry.key,
          revision: entry.revision,
          consumeOnCommit: entry.consumeOnCommit ?? false,
        });
        return {
          key: contextId,
          source: entry.source,
          scope: bucket.scope,
          channel: entry.channel,
          retention: entry.pinned
            ? "pinned" as const
            : entry.consumeOnCommit
              ? "once" as const
              : SCOPE_RETENTION[bucket.scope],
          priority: entry.priority,
          revision: entry.revision,
          content: entry.content,
          trust: entry.trust,
        };
      }));

    const compilation = compileContextSnapshot(fragments, {
      inputBudget: request.inputBudget,
    });
    const selectedManifest = compilation.manifest.filter(item => item.selected);
    const records = selectedManifest.flatMap(item => {
      const record = recordById.get(item.key);
      return record ? [record] : [];
    });
    const manifestById = new Map(compilation.manifest.map(item => [item.key, item]));
    const refs: SnapshotRecordRef[] = records.map(record => {
      const contextId = createContextId(record.bucketId, record.entryKey);
      const manifest = manifestById.get(contextId)!;
      return [contextId, record.revision, manifest.contentHash, manifest.estimatedTokens];
    });
    const leasedBucketIds = [...new Set(records.map(record => record.bucketId))];
    for (const bucketId of leasedBucketIds) {
      this.#bucketLeases.set(bucketId, (this.#bucketLeases.get(bucketId) ?? 0) + 1);
    }

    const state: MutableSnapshotState = {
      id: compilation.snapshot.id,
      status: "active",
      createdAt: now,
      owner: pickOwner(request),
      refs,
      receipts: compilation.receipts,
      manifest: compilation.manifest,
      estimatedTokens: compilation.estimatedTokens,
      inputBudget: compilation.inputBudget,
      prefixHash: compilation.prefixHash,
      records,
      leasedBucketIds,
    };
    this.#snapshots.set(state.id, state);
    return compilation.snapshot;
  }

  commitSnapshot(snapshotId: string): number {
    const state = this.#snapshots.get(snapshotId);
    if (!state || state.status !== "active") return 0;
    const committedAt = Date.now();
    let consumed = 0;
    for (const record of state.records) {
      if (!record.consumeOnCommit) continue;
      const bucket = this.#buckets.get(record.bucketId);
      const entry = bucket?.entries.get(record.entryKey);
      if (!entry || entry.revision !== record.revision) continue;
      bucket!.entries.delete(record.entryKey);
      if (bucket!.entries.size === 0) expireBucket(bucket!, "entries.empty", committedAt);
      consumed++;
    }
    state.status = "committed";
    this.#releaseLeases(state);
    this.disposeExpired();
    return consumed;
  }

  releaseSnapshot(snapshotId: string): boolean {
    const state = this.#snapshots.get(snapshotId);
    if (!state || state.status !== "active") return false;
    state.status = "released";
    this.#releaseLeases(state);
    this.disposeExpired();
    return true;
  }

  expireScope(scope: ContextScope, owner: ContextOwner, reason: ContextLifecycleEvent): number {
    return this.#expireBuckets(bucket => bucket.scope === scope && ownerMatches(owner, bucket.owner), reason);
  }

  sweepExpired(now = Date.now()): number {
    let expired = 0;
    for (const bucket of this.#buckets.values()) {
      const entryCount = bucket.entries.size;
      for (const [key, entry] of bucket.entries) {
        if (entry.expiresAt !== undefined && entry.expiresAt <= now) bucket.entries.delete(key);
      }
      if (bucket.lifecycle.state === "active" && entryCount > 0 && bucket.entries.size === 0) {
        expireBucket(bucket, "ttl.expired", now);
        expired++;
      } else if (bucket.lifecycle.state === "active"
        && bucket.lifecycle.expiresAt !== undefined
        && bucket.lifecycle.expiresAt <= now) {
        expireBucket(bucket, "ttl.expired", now);
        expired++;
      }
    }
    this.disposeExpired();

    const snapshotTtl = this.options.snapshotTtlMs ?? 60 * 60_000;
    for (const [id, state] of this.#snapshots) {
      if (state.status === "active" && now - state.createdAt >= snapshotTtl) {
        this.releaseSnapshot(id);
      }
      if (state.status !== "active" && now - state.createdAt >= snapshotTtl) this.#snapshots.delete(id);
    }
    return expired;
  }

  disposeExpired(): number {
    let disposed = 0;
    for (const [id, bucket] of this.#buckets) {
      if (bucket.lifecycle.state !== "expired" || (this.#bucketLeases.get(id) ?? 0) > 0) continue;
      bucket.lifecycle.state = "disposed";
      this.#buckets.delete(id);
      this.#bucketLeases.delete(id);
      disposed++;
    }
    return disposed;
  }

  inspectBuckets(owner: ContextOwner = {}): readonly ContextBucket[] {
    return [...this.#buckets.values()]
      .filter(bucket => ownerMatches(owner, bucket.owner))
      .map(bucket => ({
        id: bucket.id,
        scope: bucket.scope,
        owner: Object.freeze({ ...bucket.owner }),
        lifecycle: Object.freeze({ ...bucket.lifecycle }),
        entries: new Map(bucket.entries),
      }));
  }

  inspectSnapshot(snapshotId: string): ContextSnapshotState | undefined {
    const state = this.#snapshots.get(snapshotId);
    if (!state) return undefined;
    return Object.freeze({
      id: state.id,
      status: state.status,
      createdAt: state.createdAt,
      owner: Object.freeze({ ...state.owner }),
      refs: Object.freeze(state.refs.map(ref => Object.freeze([...ref]) as SnapshotRecordRef)),
      receipts: state.receipts,
      manifest: state.manifest,
      estimatedTokens: state.estimatedTokens,
      inputBudget: state.inputBudget,
      prefixHash: state.prefixHash,
    });
  }

  exportSessionState(sessionId: string, checkpointRevision = 0): PersistedContextState {
    const now = Date.now();
    const buckets = [...this.#buckets.values()]
      .filter(bucket => bucket.lifecycle.state === "active"
        && bucket.owner.sessionId === sessionId
        && (bucket.scope === "session" || bucket.scope === "topic")
        && (bucket.lifecycle.expiresAt === undefined || bucket.lifecycle.expiresAt > now))
      .flatMap(bucket => {
        const entries = [...bucket.entries.values()]
          .filter(entry => !entry.consumeOnCommit && (entry.expiresAt === undefined || entry.expiresAt > now))
          .map(entry => structuredClone(entry));
        if (entries.length === 0) return [];
        return [{
          scope: bucket.scope as PersistedContextBucket["scope"],
          owner: { ...bucket.owner },
          lifecycle: {
            expiresAt: bucket.lifecycle.expiresAt,
            expireOn: [...bucket.lifecycle.expireOn],
          },
          entries,
        }];
      });
    return {
      schemaVersion: 1,
      checkpointRevision,
      savedAt: now,
      sessionId,
      buckets,
    };
  }

  restoreSessionState(state: PersistedContextState): number {
    if (state.schemaVersion !== 1) throw new Error(`Unsupported context schema: ${state.schemaVersion}`);
    const now = Date.now();
    for (const [id, bucket] of this.#buckets) {
      if (bucket.owner.sessionId === state.sessionId
        && (bucket.scope === "session" || bucket.scope === "topic")) {
        this.#buckets.delete(id);
        this.#bucketLeases.delete(id);
      }
    }

    let restored = 0;
    for (const bucket of state.buckets) {
      if (bucket.owner.sessionId !== state.sessionId) continue;
      if (bucket.lifecycle.expiresAt !== undefined && bucket.lifecycle.expiresAt <= now) continue;
      for (const persistedEntry of bucket.entries) {
        if (persistedEntry.consumeOnCommit) continue;
        if (persistedEntry.expiresAt !== undefined && persistedEntry.expiresAt <= now) continue;
        const { revision: _revision, ...entry } = persistedEntry;
        this.put({
          scope: bucket.scope,
          owner: bucket.owner,
          lifecycle: {
            expiresAt: bucket.lifecycle.expiresAt,
            expireOn: bucket.lifecycle.expireOn,
          },
          entry,
        });
        restored++;
      }
    }
    return restored;
  }

  get bucketCount(): number { return this.#buckets.size; }
  get snapshotCount(): number { return this.#snapshots.size; }

  #expireBuckets(predicate: (bucket: MutableBucket) => boolean, reason: ContextLifecycleEvent): number {
    const now = Date.now();
    let expired = 0;
    for (const bucket of this.#buckets.values()) {
      if (bucket.lifecycle.state !== "active"
        || !predicate(bucket)
        || !bucket.lifecycle.expireOn.includes(reason)) continue;
      expireBucket(bucket, reason, now);
      expired++;
    }
    this.disposeExpired();
    return expired;
  }

  #releaseLeases(state: MutableSnapshotState): void {
    for (const bucketId of state.leasedBucketIds.splice(0)) {
      const count = (this.#bucketLeases.get(bucketId) ?? 1) - 1;
      if (count <= 0) this.#bucketLeases.delete(bucketId);
      else this.#bucketLeases.set(bucketId, count);
    }
  }

  #releaseSnapshots(owner: ContextOwner): void {
    for (const state of this.#snapshots.values()) {
      if (state.status === "active" && ownerMatches(owner, state.owner)) this.releaseSnapshot(state.id);
    }
  }

  #onTopicChanged(event: { sessionId: string; previousTopicId?: string; topicId: string }): void {
    this.#releaseSnapshots({ sessionId: event.sessionId, topicId: event.previousTopicId });
    this.#expireBuckets(
      bucket => bucket.owner.sessionId === event.sessionId
        && (bucket.scope === "topic" || bucket.scope === "task" || bucket.scope === "step"),
      "topic.changed",
    );
  }

  #onTaskEnded(taskId: string, reason: "task.completed" | "task.failed"): void {
    this.#releaseSnapshots({ taskId });
    this.#expireBuckets(
      bucket => bucket.owner.taskId === taskId && (bucket.scope === "task" || bucket.scope === "step"),
      reason,
    );
  }

  #onSessionClosed(sessionId: string): void {
    this.#releaseSnapshots({ sessionId });
    this.#expireBuckets(bucket => bucket.owner.sessionId === sessionId, "session.closed");
  }
}

function createBucketId(scope: ContextScope, owner: ContextOwner): string {
  const parts = [owner.workspaceId, owner.sessionId, owner.topicId, owner.taskId, owner.stepId]
    .map(value => value ? encodeURIComponent(value) : "-");
  return `${scope}:${parts.join(":")}`;
}

function createContextId(bucketId: string, entryKey: string): string {
  return `${bucketId}/${encodeURIComponent(entryKey)}`;
}

function ownerMatches(expected: ContextOwner, actual: ContextOwner): boolean {
  return Object.entries(expected).every(([key, value]) => value === undefined || actual[key as keyof ContextOwner] === value);
}

function pickOwner(owner: ContextOwner): ContextOwner {
  return {
    ...(owner.workspaceId ? { workspaceId: owner.workspaceId } : {}),
    ...(owner.sessionId ? { sessionId: owner.sessionId } : {}),
    ...(owner.topicId ? { topicId: owner.topicId } : {}),
    ...(owner.taskId ? { taskId: owner.taskId } : {}),
    ...(owner.stepId ? { stepId: owner.stepId } : {}),
  };
}

function sameEntry(current: ContextEntry, next: Omit<ContextEntry, "revision">): boolean {
  const { revision: _, ...currentWithoutRevision } = current;
  return isDeepStrictEqual(currentWithoutRevision, next);
}

function expireBucket(bucket: MutableBucket, reason: ContextLifecycleEvent, now: number): void {
  bucket.lifecycle.state = "expired";
  bucket.lifecycle.updatedAt = now;
  bucket.lifecycle.expiredAt = now;
  bucket.lifecycle.expiredReason = reason;
}

function freezeContent<T extends ContextEntry["content"]>(content: T): T {
  return deepFreeze(structuredClone(content));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
