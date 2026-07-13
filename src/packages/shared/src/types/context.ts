export type ContextScope = "system" | "workspace" | "session" | "topic" | "task" | "step";
export type ContextChannel = "instructions" | "messages" | "runtime" | "tool";
export type ContextRetention = "pinned" | "session" | "topic" | "task" | "step" | "once";
export type ContextTrust = "trusted" | "untrusted";
export type ContextLifecycleState = "active" | "expired" | "disposed";
export type ContextSnapshotStatus = "active" | "committed" | "released";
export type ContextLifecycleEvent =
  | "entries.empty"
  | "ttl.expired"
  | "core.stopped"
  | "workspace.closed"
  | "workspace.changed"
  | "session.closed"
  | "topic.changed"
  | "task.completed"
  | "task.failed"
  | "step.completed";

export type ContextOwner = {
  workspaceId?: string;
  sessionId?: string;
  topicId?: string;
  taskId?: string;
  stepId?: string;
};

export type ContextLifecycle = {
  state: ContextLifecycleState;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  expireOn: readonly ContextLifecycleEvent[];
  expiredAt?: number;
  expiredReason?: ContextLifecycleEvent;
};

export type ContextMessage = {
  role: string;
  content: string;
  reasoning_content?: string;
};

export type ContextEntry = {
  key: string;
  source: string;
  channel: ContextChannel;
  trust: ContextTrust;
  priority: number;
  revision: number;
  content: string | readonly ContextMessage[] | Readonly<Record<string, unknown>>;
  pinned?: boolean;
  consumeOnCommit?: boolean;
  expiresAt?: number;
};

export type ContextBucket = {
  id: string;
  scope: ContextScope;
  owner: Readonly<ContextOwner>;
  lifecycle: Readonly<ContextLifecycle>;
  entries: ReadonlyMap<string, Readonly<ContextEntry>>;
};

export type ContextPutRequest = {
  scope: ContextScope;
  owner?: ContextOwner;
  lifecycle?: {
    expiresAt?: number;
    expireOn?: readonly ContextLifecycleEvent[];
  };
  entry: Omit<ContextEntry, "revision">;
};

export type ContextSnapshotRequest = ContextOwner & {
  inputBudget?: number;
};

export type ContextFragment = {
  key: string;
  source: string;
  scope: ContextScope;
  channel: ContextChannel;
  retention: ContextRetention;
  priority: number;
  revision: number;
  content: string | readonly ContextMessage[] | Readonly<Record<string, unknown>>;
  trust?: ContextTrust;
  receiptId?: string;
  receipts?: readonly ContextReceipt[];
};

export type ContextReceipt = {
  id: string;
  fragmentKey: string;
  source: string;
  revision: number;
};

export type ContextManifestEntry = {
  key: string;
  source: string;
  scope: ContextScope;
  channel: ContextChannel;
  retention: ContextRetention;
  revision: number;
  estimatedTokens: number;
  contentHash: string;
  selected: boolean;
  reason?: "duplicate" | "budget";
};

export type ContextSnapshot = Readonly<{
  id: string;
  content: string;
}>;

export type SnapshotRecordRef = readonly [
  contextId: string,
  revision: number,
  contentHash: string,
  estimatedTokens: number,
];

export type ContextSnapshotState = Readonly<{
  id: string;
  status: ContextSnapshotStatus;
  createdAt: number;
  owner: Readonly<ContextOwner>;
  refs: readonly SnapshotRecordRef[];
  receipts: readonly Readonly<ContextReceipt>[];
  manifest: readonly Readonly<ContextManifestEntry>[];
  estimatedTokens: number;
  inputBudget: number;
  prefixHash: string;
}>;
