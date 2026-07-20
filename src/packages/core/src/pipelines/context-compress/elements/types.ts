import type { SessionMessage } from "@atom-neo/shared";
import type { ContextCompressRequest } from "@atom-neo/shared";
import type { ArchiveReceipt } from "../../../session/types";

export type CompressMode = "initial" | "archiving" | "summarizing" | "finalizing";

export type CompressFlowState = {
  mode: CompressMode;
  task: any;
  session: any;
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
