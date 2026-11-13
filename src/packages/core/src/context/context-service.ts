import { BusEvents } from "@atom-neo/shared";
import type {
  ContextBucket,
  ContextEntry,
  ContextLifecycleEvent,
  ContextOwner,
  ContextPutRequest,
  ContextScope,
  ContextSnapshot,
  ContextSnapshotRequest,
  ContextSnapshotState,
  FullEventMap,
  PipelineEventBus,
} from "@atom-neo/shared";
import { BucketStore } from "./bucket-store";
import { validateContextFormat } from "./compiler";
import type { ContextServiceOptions, PersistedContextBucket, PersistedContextState } from "./context-types";
import { SnapshotManager } from "./snapshot-manager";

export type { PersistedContextBucket, PersistedContextState } from "./context-types";

/** Public facade owning Context lifecycle, bus subscriptions, persistence and delegation. */
export class ContextService {
  #bucketStore = new BucketStore();
  #snapshotManager: SnapshotManager;
  #unsubscribers: Array<() => void> = [];
  #sweepTimer?: ReturnType<typeof setInterval>;
  #started = false;

  constructor(private readonly bus: PipelineEventBus<FullEventMap>, private readonly options: ContextServiceOptions = {}) {
    this.#snapshotManager = new SnapshotManager(this.#bucketStore, { snapshotTtlMs: options.snapshotTtlMs });
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#unsubscribers.push(
      this.bus.on(BusEvents.Context.SnapshotCommit, ({ snapshotId }) => this.commitSnapshot(snapshotId)),
      this.bus.on(BusEvents.Context.SnapshotRelease, ({ snapshotId }) => this.releaseSnapshot(snapshotId)),
      this.bus.on(BusEvents.Context.CoreStopped, () => this.#bucketStore.expireBuckets(() => true, "core.stopped")),
      this.bus.on(BusEvents.Context.WorkspaceChanged, ({ workspaceId, previousWorkspaceId }) => {
        this.#bucketStore.expireBuckets(
          bucket => bucket.scope === "workspace" && (previousWorkspaceId
            ? bucket.owner.workspaceId === previousWorkspaceId
            : bucket.owner.workspaceId !== workspaceId),
          "workspace.changed",
        );
      }),
      this.bus.on(BusEvents.Context.WorkspaceClosed, ({ workspaceId }) =>
        this.expireScope("workspace", { workspaceId }, "workspace.closed")),
      this.bus.on(BusEvents.Context.TopicChanged, event => this.#onTopicChanged(event)),
      this.bus.on(BusEvents.Context.StepCompleted, event =>
        this.expireScope("step", { taskId: event.taskId, stepId: event.stepId }, "step.completed")),
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
    if (this.#sweepTimer) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = undefined;
    }
    this.#bucketStore.clear();
    this.#snapshotManager.clear();
  }

  put(request: ContextPutRequest): Readonly<ContextEntry> {
    validateContextFormat(request.entry);
    if (request.entry.channel === "instructions" && request.entry.trust === "untrusted") {
      throw new Error(`Untrusted context cannot use the instructions channel: ${request.entry.key}`);
    }
    return this.#bucketStore.put(request);
  }

  remove(scope: ContextScope, owner: ContextOwner, key: string): boolean {
    return this.#bucketStore.remove(scope, owner, key);
  }

  get(scope: ContextScope, owner: ContextOwner, key: string): Readonly<ContextEntry> | undefined {
    return this.#bucketStore.get(scope, owner, key);
  }
  createSnapshot(request: ContextSnapshotRequest): ContextSnapshot {
    return this.#snapshotManager.createSnapshot(request);
  }
  commitSnapshot(snapshotId: string): number {
    return this.#snapshotManager.commit(snapshotId);
  }
  releaseSnapshot(snapshotId: string): boolean {
    return this.#snapshotManager.release(snapshotId);
  }
  expireScope(scope: ContextScope, owner: ContextOwner, reason: ContextLifecycleEvent): number {
    return this.#bucketStore.expireScope(scope, owner, reason);
  }
  sweepExpired(now = Date.now()): number {
    const expired = this.#bucketStore.sweepExpired(now);
    this.#bucketStore.disposeExpired();
    this.#snapshotManager.sweepExpired(now);
    return expired;
  }
  disposeExpired(): number {
    return this.#bucketStore.disposeExpired();
  }
  inspectBuckets(owner: ContextOwner = {}): readonly ContextBucket[] {
    return this.#bucketStore.inspect(owner);
  }
  inspectSnapshot(snapshotId: string): ContextSnapshotState | undefined {
    return this.#snapshotManager.inspect(snapshotId);
  }

  exportSessionState(sessionId: string, checkpointRevision = 0): PersistedContextState {
    const now = Date.now();
    const buckets = [...this.#bucketStore.values()]
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
          lifecycle: { expiresAt: bucket.lifecycle.expiresAt, expireOn: [...bucket.lifecycle.expireOn] },
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
    this.#bucketStore.deleteBuckets(bucket => bucket.owner.sessionId === state.sessionId
      && (bucket.scope === "session" || bucket.scope === "topic"));
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
          lifecycle: { expiresAt: bucket.lifecycle.expiresAt, expireOn: bucket.lifecycle.expireOn },
          entry,
        });
        restored++;
      }
    }
    return restored;
  }

  get bucketCount(): number { return this.#bucketStore.size; }
  get snapshotCount(): number { return this.#snapshotManager.size; }

  #onTopicChanged(event: { sessionId: string; previousTopicId?: string; topicId: string }): void {
    this.#snapshotManager.releaseByOwner({ sessionId: event.sessionId, topicId: event.previousTopicId });
    this.#bucketStore.expireBuckets(
      bucket => bucket.owner.sessionId === event.sessionId
        && (bucket.scope === "topic" || bucket.scope === "task" || bucket.scope === "step"),
      "topic.changed",
    );
  }

  #onTaskEnded(taskId: string, reason: "task.completed" | "task.failed"): void {
    this.#snapshotManager.releaseByOwner({ taskId });
    this.#bucketStore.expireBuckets(
      bucket => bucket.owner.taskId === taskId && (bucket.scope === "task" || bucket.scope === "step"),
      reason,
    );
  }

  #onSessionClosed(sessionId: string): void {
    this.#snapshotManager.releaseByOwner({ sessionId });
    this.#bucketStore.expireBuckets(bucket => bucket.owner.sessionId === sessionId, "session.closed");
  }
}
