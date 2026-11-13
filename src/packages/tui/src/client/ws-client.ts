import { WsMessages } from "@atom-neo/shared";
import type { DecisionUpdatePayload, ServerEvent, SessionTelemetry } from "@atom-neo/shared";
import { parseServerEvent, TuiTaskError } from "./ws-client-protocol";
import type {
  BusyChangeCallback, ContextTokensCallback, DeltaCallback, MCPConnectedCallback, MCPStatusCallback,
  ReasonCallback, ToolCallback, ToolGroupCompleteCallback, ToolStepCallback,
} from "./ws-client-protocol";

export { TuiTaskError } from "./ws-client-protocol";

export class TuiClient {
  #url: string;
  #sessionId: string;
  #chatId: string;
  #ws: WebSocket | null = null;
  #ready = false;
  #onSnapshot?: (messages: { role: string; content: string; timestamp: number; seq?: number; visible?: boolean }[]) => void;
  #onDisconnect?: () => void;
  #onDelta?: DeltaCallback;
  #onReason?: ReasonCallback;
  #onTool?: ToolCallback;
  #onToolStep?: ToolStepCallback;
  #onToolGroupComplete?: ToolGroupCompleteCallback;
  #onContextTokens?: ContextTokensCallback;
  #onTelemetry?: (telemetry: SessionTelemetry) => void;
  #onBusyChange?: BusyChangeCallback;
  #onMCPStatus?: MCPStatusCallback;
  #onMCPConnected?: MCPConnectedCallback;
  #onDecisionUpdate?: (update: DecisionUpdatePayload) => void;
  #currentRootTaskId: string | null = null;
  #earlyDecisions: DecisionUpdatePayload[] = [];
  #activeTaskIds: Set<string> = new Set();
  #pending: { resolve: (text: string) => void; reject: (err: Error) => void; text: string; rootTaskId: string }[] = [];

  constructor(params: { url?: string; sessionId?: string; chatId?: string } = {}) {
    this.#url = (params.url ?? "http://127.0.0.1:3100").replace(/^http/, "ws");
    this.#sessionId = params.sessionId ?? `tui-${Date.now()}`;
    this.#chatId = params.chatId ?? "default";
  }

  get sessionId(): string { return this.#sessionId; }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#ws = new WebSocket(`${this.#url}/ws/${encodeURIComponent(this.#sessionId)}`);

      const timer = setTimeout(() => {
        reject(new Error("Core handshake timed out"));
        this.#ws?.close();
      }, 10_000);
      this.#ws.onopen = () => {};

      this.#ws.onmessage = (event) => {
        try {
          const parsed = parseServerEvent(JSON.parse(event.data as string));
          if (parsed) this.#handleServerEvent(parsed, resolve, timer);
        } catch { /* ignore */ }
      };

      this.#ws.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket connection failed")); };
      this.#ws.onclose = () => {
        clearTimeout(timer);
        this.#ready = false;
        reject(new Error("Connection closed before ready"));
        for (const pending of this.#pending) pending.reject(new Error("Core disconnected; task may still be running"));
        this.#pending = [];
        this.#activeTaskIds.clear();
        this.#onBusyChange?.(false);
        this.#onDisconnect?.();
      };
    });
  }

  #handleServerEvent(event: ServerEvent, resolveReady: () => void, readyTimer: ReturnType<typeof setTimeout>): void {
    switch (event.type) {
      case WsMessages.Server.SessionReady: {
        const p = event.payload;
        this.#currentRootTaskId = null;
        this.#earlyDecisions = [];
        this.#activeTaskIds = new Set(p.activeTaskIds ?? []);
        this.#onSnapshot?.(p.messages ?? []);
        this.#onTelemetry?.(p.telemetry ?? { sessionId: this.#sessionId, rounds: null, todos: [] });
        this.#onBusyChange?.(this.#activeTaskIds.size > 0);
        clearTimeout(readyTimer);
        if (typeof p.contextTokens === "number") this.#onContextTokens?.(p.contextTokens);
        this.#ready = true;
        resolveReady();
        return;
      }
      case WsMessages.Server.SessionTelemetry: {
        const p = event.payload;
        if (p.sessionId === this.#sessionId) this.#onTelemetry?.(p);
        return;
      }
      case WsMessages.Server.TransportDelta: {
        const p = event.payload;
        const delta = p.textDelta ?? "";
        const offset = p.offset ?? 0;
        if (delta) {
          const head = this.#pending[0];
          if (head) head.text += delta;
          this.#onDelta?.(delta, offset);
        }
        return;
      }
      case WsMessages.Server.TransportReason: {
        const p = event.payload;
        const delta = p.textDelta ?? "";
        if (delta) this.#onReason?.(delta, p.offset ?? 0);
        return;
      }
      case WsMessages.Server.TransportToolStarted: {
        const p = event.payload;
        this.#onTool?.({ name: p.toolName ?? "", callId: p.toolCallId ?? "", input: p.input });
        return;
      }
      case WsMessages.Server.TransportToolFinished: {
        const p = event.payload;
        this.#onTool?.({ name: p.toolName ?? "", callId: p.toolCallId ?? "", result: p.result, error: p.error });
        return;
      }
      case WsMessages.Server.TransportToolStepFinished: {
        const p = event.payload;
        this.#onToolStep?.({ total: p.total ?? 0, success: p.success ?? 0, failed: p.failed ?? 0, toolNames: p.toolNames ?? [] });
        return;
      }
      case WsMessages.Server.TransportToolGroupComplete: {
        const p = event.payload;
        this.#onToolGroupComplete?.({ total: p.total ?? 0, success: p.success ?? 0, failed: p.failed ?? 0, toolNames: p.toolNames ?? [] });
        return;
      }
      case WsMessages.Server.TaskCompleted: {
        const p = event.payload;
        if (p.terminal === true) {
          const index = this.#pending.findIndex(pending => pending.rootTaskId === p.rootTaskId);
          if (index >= 0) {
            const done = this.#pending.splice(index, 1)[0];
            done.resolve(done.text);
          }
        }
        const contextTokens = p.contextTokens ?? p.tokenUsage?.total;
        if (typeof contextTokens === "number") this.#onContextTokens?.(contextTokens);
        return;
      }
      case WsMessages.Server.TaskFailed: {
        const p = event.payload;
        const rootTaskId = p.rootTaskId ?? p.taskId;
        const index = this.#pending.findIndex(pending => pending.rootTaskId === rootTaskId);
        if (index < 0) return;
        const pending = this.#pending.splice(index, 1)[0];
        const err = p.error ?? "Unknown error";
        const error = new TuiTaskError(String(err), typeof p.code === "string" ? p.code : undefined);
        pending.reject(error);
        return;
      }
      case WsMessages.Server.SessionTaskActive: {
        const { active, taskId } = event.payload;
        if (active === false) {
          this.#activeTaskIds.delete(taskId ?? "");
        } else {
          this.#activeTaskIds.add(taskId ?? "");
        }
        this.#onBusyChange?.(this.#activeTaskIds.size > 0);
        return;
      }
      case WsMessages.Server.MCPToolStatus: {
        const servers = event.payload.servers ?? [];
        if (servers.length > 0) this.#onMCPStatus?.(servers);
        return;
      }
      case WsMessages.Server.MCPConnected: {
        const p = event.payload;
        this.#onMCPConnected?.({ servers: p.servers ?? [], toolInfos: p.toolInfos ?? [] });
        return;
      }
      case WsMessages.Server.DecisionUpdated: {
        const p = event.payload;
        if (p.sessionId !== this.#sessionId || typeof p.rootTaskId !== "string") return;
        const update: DecisionUpdatePayload = p;
        if (this.#currentRootTaskId === null) {
          this.#earlyDecisions.push(update);
          this.#earlyDecisions = this.#earlyDecisions.slice(-8);
        } else if (update.rootTaskId === this.#currentRootTaskId) {
          this.#onDecisionUpdate?.(update);
        }
        return;
      }
      case WsMessages.Server.TaskCreated:
      case WsMessages.Server.TaskStateChanged:
      case WsMessages.Server.PipelineElementStarted:
      case WsMessages.Server.PipelineElementFinished:
      case WsMessages.Server.ReplayStart:
      case WsMessages.Server.ReplayEnd:
      case WsMessages.Control.Pong:
      case WsMessages.Control.Error:
        return;
      default: {
        const unhandled: never = event;
        void unhandled;
      }
    }
  }

  async send(text: string): Promise<string> {
    if (!this.#ws || !this.#ready) throw new Error("Not connected");
    this.#currentRootTaskId = null;
    this.#earlyDecisions = [];

    const httpUrl = this.#url.replace(/^ws/, "http");
    const res = await fetch(`${httpUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: this.#sessionId, chatId: this.#chatId, platform: "tui", initiator: { type: "tui" }, data: { text },
      }),
    });
    const response = await res.json().catch(() => ({})) as { taskId?: unknown; error?: unknown };
    if (!res.ok) throw new Error(String(response.error ?? `Task submission failed (${res.status})`));
    if (typeof response.taskId !== "string" || !response.taskId) {
      throw new Error("Invalid task submission response");
    }
    const taskId = response.taskId;
    this.#currentRootTaskId = taskId;
    for (const update of this.#earlyDecisions) {
      if (update.rootTaskId === taskId) this.#onDecisionUpdate?.(update);
    }
    this.#earlyDecisions = [];

    return new Promise<string>((resolve, reject) => {
      this.#pending.push({ resolve, reject, text: "", rootTaskId: taskId });
    });
  }

  onSnapshot(cb: (messages: { role: string; content: string; timestamp: number; seq?: number; visible?: boolean }[]) => void): void { this.#onSnapshot = cb; }
  onDisconnect(cb: () => void): void { this.#onDisconnect = cb; }

  onDelta(cb: DeltaCallback): void { this.#onDelta = cb; }
  onReason(cb: ReasonCallback): void { this.#onReason = cb; }
  onTool(cb: ToolCallback): void { this.#onTool = cb; }
  onToolStepFinish(cb: ToolStepCallback): void { this.#onToolStep = cb; }
  onToolGroupComplete(cb: ToolGroupCompleteCallback): void { this.#onToolGroupComplete = cb; }
  onContextTokens(cb: ContextTokensCallback): void { this.#onContextTokens = cb; }
  onTelemetry(cb: (telemetry: SessionTelemetry) => void): void { this.#onTelemetry = cb; }
  onBusyChange(cb: BusyChangeCallback): void { this.#onBusyChange = cb; }
  onMCPStatus(cb: MCPStatusCallback): void { this.#onMCPStatus = cb; }
  onMCPConnected(cb: MCPConnectedCallback): void { this.#onMCPConnected = cb; }
  onDecisionUpdate(cb: (update: DecisionUpdatePayload) => void): void { this.#onDecisionUpdate = cb; }

  close(): void {
    for (const p of this.#pending) p.reject(new Error("Connection closed"));
    this.#pending = [];
    this.#activeTaskIds.clear();
    this.#currentRootTaskId = null;
    this.#earlyDecisions = [];
    this.#onDisconnect = undefined;
    this.#ws?.close();
    this.#ready = false;
  }

  cancelActiveTask(): boolean {
    if (!this.#ws || !this.#ready) return false;
    const taskId = [...this.#activeTaskIds].at(-1);
    if (!taskId) return false;
    this.#ws.send(JSON.stringify({
      type: WsMessages.Client.TaskCancel,
      payload: { taskId },
    }));
    return true;
  }

  sendCompact(): void {
    if (this.#ws && this.#ready) {
      this.#ws.send(JSON.stringify({ type: WsMessages.Client.Compact }));
    }
  }
}
