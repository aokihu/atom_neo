import type { ContinuationContext, InferenceFact, SessionMessage } from "@atom-neo/shared";
import type { TodoItem } from "./context";

export type PersistedSessionStatus = "active" | "suspended" | "interrupted" | "completed" | "failed";

export type SessionCheckpointReason =
  | "message"
  | "task_completed"
  | "task_failed"
  | "compressed"
  | "restore"
  | "idle"
  | "capacity"
  | "shutdown";

export type SessionArchiveState = {
  segmentCount: number;
  archivedMessageCount: number;
  latestMessageCount: number;
  nextSegment: number;
};

export type PersistedSessionState = {
  schemaVersion: 1;
  checkpointRevision: number;
  sessionId: string;
  status: PersistedSessionStatus;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  endedAt?: number;
  closeReason?: SessionCheckpointReason;
  currentTopic: string | null;
  chainDepth: number;
  todoState: TodoItem[];
  continuationContext: ContinuationContext | null;
  inferenceFacts: InferenceFact[];
  tokenUsage: { total: number };
  contextTokens: number;
  nextMessageSeq: number;
  archives: SessionArchiveState;
};

export type ArchiveReceipt = {
  archiveId: string;
  segment: number;
  fromSeq: number;
  toSeq: number;
  count: number;
};

export type HistoryMatch = {
  archiveId: string;
  seq: number;
  role: SessionMessage["role"];
  timestamp: number;
  content: string;
};
