import type { MemorySearchRequest } from "./memory";

export enum TaskSource {
  EXTERNAL = "external",
  INTERNAL = "internal",
}

export enum TaskPriority {
  EXTERNAL = 10,
  INTERNAL = 50,
  USER_CANCEL = 100,
}

export enum TaskState {
  WAITING = "waiting",
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
  FOLLOW_UP = "follow_up",
  DISPATCHED = "dispatched",
  SUSPEND = "suspend",
}

export type TaskOrigin = { type: "hook"; hookId: string };

export type ContextCompressRequest = {
  trigger: "manual" | "token-overflow" | "context-pressure";
  resumeConversation: boolean;
};

export type TaskItem = {
  readonly id: string;
  readonly chainId: string;
  readonly parentTaskId: string | null;
  readonly sessionId: string;
  readonly chatId: string;
  readonly source: TaskSource;
  readonly pipeline: string;
  readonly priority: number;
  readonly createdAt: number;
  readonly payload: TaskPayload[];
  readonly origin?: TaskOrigin;
  state: TaskState;
  updatedAt: number;
};

export type TaskPayload =
  | { type: "text"; data: string }
  | { type: "image"; data: string }
  | { type: "audio"; data: string }
  | { type: "tool_report"; data: TaskToolReport }
  | { type: "memory_search_request"; data: MemorySearchRequest }
  | { type: "context_compress_request"; data: ContextCompressRequest };

export type TaskToolCall = {
  toolName: string;
  toolCallId: string;
  input: unknown;
};

export type TaskToolReport = {
  ok: boolean;
  summary: string;
  createdAt: number;
  facts: ToolReportFact[];
};

export type ToolReportFact = {
  key: string;
  toolName: string;
  toolCallId: string;
  target: string;
  summary: string;
  outputSummary: string;
  outputDetail: string;
  errorMessage: string;
  reusable: boolean;
  snapshotText: string;
};
