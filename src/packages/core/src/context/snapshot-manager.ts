import type {
  ContextOwner,
  ContextSnapshot,
  ContextSnapshotRequest,
  ContextSnapshotState,
  SnapshotRecordRef,
} from "@atom-neo/shared";
import { compileContextSnapshot } from "./compiler";
import type { BucketStore } from "./bucket-store";
import { createContextId, filterMatchesOwner, pickOwner } from "./context-codec";
import type { MutableSnapshotState, SnapshotRecord } from "./context-types";
import { SCOPE_RETENTION } from "./context-types";

/** Owns snapshot state, bucket leases and snapshot TTL sweeping. */
export class SnapshotManager {
  #snapshots = new Map<string, MutableSnapshotState>();

  constructor(
    private readonly buckets: BucketStore,
    private readonly options: { snapshotTtlMs?: number } = {},
  ) {}

  createSnapshot(request: ContextSnapshotRequest): ContextSnapshot {
    const now = Date.now();
    this.buckets.sweepExpired(now);
    this.buckets.disposeExpired();
    this.sweepExpired(now);

    const selectedBuckets = this.buckets.activeBuckets(request);
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
          format: entry.format,
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
    this.buckets.lease(leasedBucketIds);

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

  commit(snapshotId: string): number {
    const state = this.#snapshots.get(snapshotId);
    if (!state || state.status !== "active") return 0;
    const committedAt = Date.now();
    let consumed = 0;
    for (const record of state.records) {
      if (!record.consumeOnCommit) continue;
      if (this.buckets.removeConsumeOnCommit(record.bucketId, record.entryKey, record.revision, committedAt)) {
        consumed++;
      }
    }
    state.status = "committed";
    this.#releaseLeases(state);
    this.buckets.disposeExpired();
    return consumed;
  }

  release(snapshotId: string): boolean {
    const state = this.#snapshots.get(snapshotId);
    if (!state || state.status !== "active") return false;
    state.status = "released";
    this.#releaseLeases(state);
    this.buckets.disposeExpired();
    return true;
  }

  inspect(snapshotId: string): ContextSnapshotState | undefined {
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

  releaseByOwner(owner: ContextOwner): void {
    for (const state of this.#snapshots.values()) {
      if (state.status === "active" && filterMatchesOwner(owner, state.owner)) this.release(state.id);
    }
  }

  sweepExpired(now = Date.now()): void {
    const snapshotTtl = this.options.snapshotTtlMs ?? 60 * 60_000;
    for (const [id, state] of this.#snapshots) {
      if (state.status === "active" && now - state.createdAt >= snapshotTtl) {
        this.release(id);
      }
      if (state.status !== "active" && now - state.createdAt >= snapshotTtl) this.#snapshots.delete(id);
    }
  }

  get size(): number {
    return this.#snapshots.size;
  }

  clear(): void {
    this.#snapshots.clear();
  }

  #releaseLeases(state: MutableSnapshotState): void {
    for (const bucketId of state.leasedBucketIds.splice(0)) {
      this.buckets.releaseLease(bucketId);
    }
  }
}
