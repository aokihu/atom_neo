import type { DecisionUpdatePayload, SessionTelemetry, TodoItem } from "@atom-neo/shared";
import type { MCPServerInfo, Message, ToolInfo } from "../../types";

export type ToolEventParams = {
  name: string;
  callId: string;
  input?: unknown;
  result?: unknown;
  error?: unknown;
};

export type MessageSlice = {
  messages: Message[];
  generateId: () => string;
  addMessage: (msg: Message) => void;
  addTransientMessage: (msg: Message, durationMs: number) => void;
  updateMessage: (id: string, patch: Partial<Message>) => void;
  clearMessages: () => void;
};

export type StreamSlice = {
  busy: boolean;
  showPreparing: boolean;
  activeAssistantId: string | null;
  streamReceivedChars: number;
  streamChunkCount: number;
  streamTokenBatches: number[];

  handleDelta: (delta: string, offset: number, reasoning?: string, thinkingDuration?: number) => void;
  handleReason: (delta: string) => void;
  recordStreamChunk: (text: string) => void;
  setBusy: (busy: boolean) => void;
  prepareForSend: () => void;
  setShowPreparing: (v: boolean) => void;
};

export type ToolSlice = {
  toolGroupId: string | null;
  handleToolEvent: (event: ToolEventParams) => "created" | "updated" | null;
  handleToolStepFinish: (total: number, success: number, failed: number, toolNames: string[]) => void;
  handleToolGroupComplete: (total: number, success: number, failed: number, toolNames: string[]) => void;
};

export type TelemetrySlice = {
  contextTokens: number;
  todoItems: TodoItem[];
  rounds: SessionTelemetry["rounds"];
  telemetryOnline: boolean;
  toolInfos: ToolInfo[];
  mcpServers: MCPServerInfo[];
  predictionDecision: DecisionUpdatePayload | null;
  postDecision: DecisionUpdatePayload | null;

  setContextTokens: (total: number) => void;
  setTodoItems: (todos: TodoItem[]) => void;
  setToolInfos: (infos: ToolInfo[]) => void;
  updateMCPConnected: (data: {
    servers: { name: string; online: boolean; toolCount: number }[];
    toolInfos: { name: string; source: string; description: string; online: boolean }[];
  }) => void;
  updateMCPStatus: (servers: { name: string; online: boolean; toolNames: string[] }[]) => void;
  setDecisionUpdate: (update: DecisionUpdatePayload) => void;
};

export type ChatState = MessageSlice & StreamSlice & ToolSlice & TelemetrySlice;
