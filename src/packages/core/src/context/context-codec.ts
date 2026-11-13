import { isDeepStrictEqual } from "node:util";
import type { ContextEntry, ContextLifecycleEvent, ContextOwner, ContextScope } from "@atom-neo/shared";
import type { MutableBucket } from "./context-types";

export function createBucketId(scope: ContextScope, owner: ContextOwner): string {
  const parts = [owner.workspaceId, owner.sessionId, owner.topicId, owner.taskId, owner.stepId]
    .map(value => value ? encodeURIComponent(value) : "-");
  return `${scope}:${parts.join(":")}`;
}

export function createContextId(bucketId: string, entryKey: string): string {
  return `${bucketId}/${encodeURIComponent(entryKey)}`;
}

/** Every defined key in the filter must match the owner. Missing owner fields never match a defined filter value. */
export function filterMatchesOwner(filter: ContextOwner, owner: ContextOwner): boolean {
  return Object.entries(filter).every(([key, value]) => value === undefined || owner[key as keyof ContextOwner] === value);
}

export function pickOwner(owner: ContextOwner): ContextOwner {
  return {
    ...(owner.workspaceId ? { workspaceId: owner.workspaceId } : {}),
    ...(owner.sessionId ? { sessionId: owner.sessionId } : {}),
    ...(owner.topicId ? { topicId: owner.topicId } : {}),
    ...(owner.taskId ? { taskId: owner.taskId } : {}),
    ...(owner.stepId ? { stepId: owner.stepId } : {}),
  };
}

export function sameEntry(current: ContextEntry, next: Omit<ContextEntry, "revision">): boolean {
  const { revision: _, ...currentWithoutRevision } = current;
  return isDeepStrictEqual(currentWithoutRevision, next);
}

export function expireBucket(bucket: MutableBucket, reason: ContextLifecycleEvent, now: number): void {
  bucket.lifecycle.state = "expired";
  bucket.lifecycle.updatedAt = now;
  bucket.lifecycle.expiredAt = now;
  bucket.lifecycle.expiredReason = reason;
}

export function freezeContent<T extends ContextEntry["content"]>(content: T): T {
  return deepFreeze(structuredClone(content));
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
