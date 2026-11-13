import type {
  ContextBucket,
  ContextEntry,
  ContextLifecycleEvent,
  ContextOwner,
  ContextPutRequest,
  ContextScope,
} from "@atom-neo/shared";
import { createBucketId, expireBucket, filterMatchesOwner, freezeContent, sameEntry } from "./context-codec";
import type { MutableBucket } from "./context-types";
import { DEFAULT_EXPIRE_ON } from "./context-types";

/** Owns bucket storage, lifecycle transitions and snapshot leases. */
export class BucketStore {
  #buckets = new Map<string, MutableBucket>();
  #leases = new Map<string, number>();

  put(request: ContextPutRequest): Readonly<ContextEntry> {
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

  inspect(owner: ContextOwner = {}): readonly ContextBucket[] {
    return [...this.#buckets.values()]
      .filter(bucket => filterMatchesOwner(owner, bucket.owner))
      .map(bucket => ({
        id: bucket.id,
        scope: bucket.scope,
        owner: Object.freeze({ ...bucket.owner }),
        lifecycle: Object.freeze({ ...bucket.lifecycle }),
        entries: new Map(bucket.entries),
      }));
  }

  values(): IterableIterator<MutableBucket> {
    return this.#buckets.values();
  }

  activeBuckets(owner: ContextOwner): MutableBucket[] {
    return [...this.#buckets.values()]
      .filter(bucket => bucket.lifecycle.state === "active" && filterMatchesOwner(bucket.owner, owner));
  }

  expireScope(scope: ContextScope, owner: ContextOwner, reason: ContextLifecycleEvent): number {
    return this.expireBuckets(bucket => bucket.scope === scope && filterMatchesOwner(owner, bucket.owner), reason);
  }

  expireBuckets(predicate: (bucket: MutableBucket) => boolean, reason: ContextLifecycleEvent): number {
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
    return expired;
  }

  disposeExpired(): number {
    let disposed = 0;
    for (const [id, bucket] of this.#buckets) {
      if (bucket.lifecycle.state !== "expired" || this.isLeased(id)) continue;
      bucket.lifecycle.state = "disposed";
      this.#buckets.delete(id);
      this.#leases.delete(id);
      disposed++;
    }
    return disposed;
  }

  /** Deletes a consumed entry only when it is still the revision captured by the snapshot. */
  removeConsumeOnCommit(bucketId: string, entryKey: string, revision: number, now: number): boolean {
    const bucket = this.#buckets.get(bucketId);
    const entry = bucket?.entries.get(entryKey);
    if (!entry || entry.revision !== revision) return false;
    bucket!.entries.delete(entryKey);
    if (bucket!.entries.size === 0) expireBucket(bucket!, "entries.empty", now);
    return true;
  }

  lease(bucketIds: readonly string[]): void {
    for (const bucketId of bucketIds) {
      this.#leases.set(bucketId, (this.#leases.get(bucketId) ?? 0) + 1);
    }
  }

  releaseLease(bucketId: string): void {
    const count = (this.#leases.get(bucketId) ?? 1) - 1;
    if (count <= 0) this.#leases.delete(bucketId);
    else this.#leases.set(bucketId, count);
  }

  isLeased(bucketId: string): boolean {
    return (this.#leases.get(bucketId) ?? 0) > 0;
  }

  leaseCount(bucketId: string): number {
    return this.#leases.get(bucketId) ?? 0;
  }

  deleteBuckets(predicate: (bucket: MutableBucket) => boolean): void {
    for (const [id, bucket] of this.#buckets) {
      if (!predicate(bucket)) continue;
      this.#buckets.delete(id);
      this.#leases.delete(id);
    }
  }

  get size(): number {
    return this.#buckets.size;
  }

  clear(): void {
    this.#buckets.clear();
    this.#leases.clear();
  }
}
