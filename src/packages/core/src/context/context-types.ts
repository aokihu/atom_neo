import type {
  ContextEntry,
  ContextLifecycle,
  ContextLifecycleEvent,
  ContextOwner,
  ContextScope,
  ContextSnapshotState,
  SnapshotRecordRef,
} from "@atom-neo/shared";

export type MutableBucket = {
  id: string;
  scope: ContextScope;
  owner: ContextOwner;
  lifecycle: ContextLifecycle;
  entries: Map<string, ContextEntry>;
  revisions: Map<string, number>;
};

export type SnapshotRecord = {
  bucketId: string;
  entryKey: string;
  revision: number;
  consumeOnCommit: boolean;
};

export type MutableSnapshotState = {
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

export type ContextServiceOptions = {
  sweepIntervalMs?: number;
  snapshotTtlMs?: number;
};

export const SCOPE_RETENTION: Record<ContextScope, "pinned" | "session" | "topic" | "task" | "step"> = {
  system: "pinned",
  workspace: "pinned",
  session: "session",
  topic: "topic",
  task: "task",
  step: "step",
};

export const DEFAULT_EXPIRE_ON: Record<ContextScope, readonly ContextLifecycleEvent[]> = {
  system: ["core.stopped"],
  workspace: ["workspace.closed", "workspace.changed", "core.stopped"],
  session: ["session.closed", "core.stopped"],
  topic: ["topic.changed", "session.closed", "core.stopped"],
  task: ["task.completed", "task.failed", "topic.changed", "session.closed", "core.stopped"],
  step: ["step.completed", "task.completed", "task.failed", "topic.changed", "session.closed", "core.stopped"],
};
