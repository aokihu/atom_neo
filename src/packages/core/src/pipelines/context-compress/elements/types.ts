import type { SessionMessage } from "@atom-neo/shared";
import type { ContextCompressRequest } from "@atom-neo/shared";
import type { ArchiveReceipt } from "@core/session/types";
import type { CheckpointSession, ElementTask } from "@core/session/element-session";

export type CompressMode = "initial" | "archiving" | "summarizing" | "finalizing";

export type CompressFlowState = {
  mode: CompressMode;
  task: ElementTask;
  session: CheckpointSession;
  request: ContextCompressRequest;
  archiveMessages: SessionMessage[];
  summaryMessages: SessionMessage[];
  archiveReceipt?: ArchiveReceipt;
  archiveError?: string;
  keepCount?: number;
  summaryText: string;
  summary?: string;
  summaryError?: string;
  summaryMaxTokens: number;
  abortSignal?: AbortSignal;
};
