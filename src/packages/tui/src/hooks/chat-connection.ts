import { TuiClient } from "../client/ws-client";
import { useChatStore } from "../stores/chat";
import type { MCPServerInfo, ToolInfo } from "../types";
import type { DecisionUpdatePayload, SessionTelemetry } from "@atom-neo/shared";
import { mapChatSnapshot, submitChatMessage } from "./chat-messages";
import type { ChatSnapshotMessage } from "./chat-messages";
import type { ChatClientError } from "./chat-errors";

export { mapChatSnapshot, submitChatMessage } from "./chat-messages";
export type { ChatSnapshotMessage } from "./chat-messages";

type ToolEvent = { name: string; callId: string; input?: unknown; result?: unknown; error?: unknown };
type ToolStepEvent = { total: number; success: number; failed: number; toolNames: string[] };
type MCPServerStatus = { name: string; online: boolean; toolNames: string[] };
type MCPConnectedData = {
  servers: { name: string; online: boolean; toolCount: number }[];
  toolInfos: { name: string; source: string; description: string; online: boolean }[];
};

export type ChatConnectionClient = {
  sessionId: string;
  connect: () => Promise<void>;
  close: () => void;
  send: (text: string) => Promise<string>;
  sendCompact: () => void;
  cancelActiveTask: () => boolean;
  onSnapshot: (cb: (messages: ChatSnapshotMessage[]) => void) => void;
  onDisconnect: (cb: () => void) => void;
  onDelta: (cb: (delta: string, offset: number) => void) => void;
  onReason: (cb: (delta: string, offset: number) => void) => void;
  onTool: (cb: (event: ToolEvent) => void) => void;
  onToolStepFinish: (cb: (event: ToolStepEvent) => void) => void;
  onToolGroupComplete: (cb: (event: ToolStepEvent) => void) => void;
  onContextTokens: (cb: (total: number) => void) => void;
  onTelemetry: (cb: (telemetry: SessionTelemetry) => void) => void;
  onBusyChange: (cb: (busy: boolean) => void) => void;
  onMCPStatus: (cb: (servers: MCPServerStatus[]) => void) => void;
  onMCPConnected: (cb: (data: MCPConnectedData) => void) => void;
  onDecisionUpdate: (cb: (update: DecisionUpdatePayload) => void) => void;
};

export type ChatConnection = {
  client: ChatConnectionClient;
  send: (text: string, onClientError?: (error: ChatClientError) => void) => Promise<void>;
  compact: () => void;
  cancel: () => boolean;
  close: () => void;
};

export type ChatConnectionOptions = {
  url: string;
  sessionId?: string;
  initialToolInfos?: ToolInfo[];
  initialMCPServers?: MCPServerInfo[];
  createClient?: (params: { url: string; sessionId?: string }) => ChatConnectionClient;
};

export function connectChat(options: ChatConnectionOptions): ChatConnection {
  const store = useChatStore;
  if (options.initialToolInfos) store.setState({ toolInfos: options.initialToolInfos });
  if (options.initialMCPServers) store.setState({ mcpServers: options.initialMCPServers });

  const client = options.createClient?.({ url: options.url, sessionId: options.sessionId })
    ?? new TuiClient({ url: options.url, sessionId: options.sessionId });
  store.setState({ rounds: null, todoItems: [], telemetryOnline: false });

  let active = true;
  let activity = false;
  let thinkingStart = 0;
  let reasoningBuffer = "";
  const isCurrent = () => active;

  client.onSnapshot(messages => {
    store.setState({
      predictionDecision: null,
      postDecision: null,
      messages: mapChatSnapshot(client.sessionId, messages),
    });
  });
  client.onTelemetry(telemetry => {
    if (isCurrent()) store.setState({ rounds: telemetry.rounds, todoItems: telemetry.todos, telemetryOnline: true });
  });
  client.onDisconnect(() => {
    if (!isCurrent()) return;
    store.setState({ rounds: null, todoItems: [], telemetryOnline: false });
    store.getState().addMessage({
      id: store.getState().generateId(),
      role: "error",
      content: "Core disconnected. Attach again to resume this session.",
      timestamp: Date.now(),
    });
  });
  client.onContextTokens(total => store.getState().setContextTokens(total));
  client.onReason(delta => {
    if (!activity) {
      activity = true;
      store.getState().setShowPreparing(false);
      thinkingStart = Date.now();
    }
    reasoningBuffer += delta;
  });
  client.onDelta((delta, offset) => {
    const reasoning = reasoningBuffer;
    if (!activity) {
      activity = true;
      thinkingStart = Date.now();
      reasoningBuffer = "";
    } else {
      reasoningBuffer = "";
    }
    const duration = reasoning && thinkingStart
      ? Math.round((Date.now() - thinkingStart) / 1000)
      : undefined;
    store.getState().handleDelta(delta, offset, reasoning || undefined, duration);
  });
  client.onTool(event => store.getState().handleToolEvent(event));
  client.onToolStepFinish(event =>
    store.getState().handleToolStepFinish(event.total, event.success, event.failed, event.toolNames));
  client.onToolGroupComplete(event =>
    store.getState().handleToolGroupComplete(event.total, event.success, event.failed, event.toolNames));
  client.onBusyChange(busy => store.getState().setBusy(busy));
  client.onDecisionUpdate(update => store.getState().setDecisionUpdate(update));
  client.onMCPConnected(data => store.getState().updateMCPConnected(data));
  client.onMCPStatus(servers => store.getState().updateMCPStatus(servers));

  client.connect().catch(() => {
    store.getState().addMessage({
      role: "error",
      content: "Connection failed",
      id: store.getState().generateId(),
      timestamp: Date.now(),
    });
  });

  return {
    client,
    send: async (text, onClientError) => {
      activity = false;
      thinkingStart = 0;
      reasoningBuffer = "";
      await submitChatMessage(client, text, onClientError);
    },
    compact: () => client.sendCompact(),
    cancel: () => client.cancelActiveTask(),
    close: () => {
      active = false;
      client.close();
    },
  };
}
