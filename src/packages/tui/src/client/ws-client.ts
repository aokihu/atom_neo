type DeltaCallback = (delta: string, offset: number) => void;
type ReasonCallback = (delta: string, offset: number) => void;
type ToolCallback = (event: { name: string; callId: string; input?: unknown; result?: unknown; error?: unknown }) => void;
type ToolStepCallback = (event: { total: number; success: number; failed: number; toolNames: string[] }) => void;
type ToolGroupCompleteCallback = (event: { total: number; success: number; failed: number; toolNames: string[] }) => void;
type ContextTokensCallback = (total: number) => void;
type BusyChangeCallback = (busy: boolean) => void;
type MCPStatusCallback = (servers: { name: string; online: boolean; toolNames: string[] }[]) => void;
type MCPConnectedCallback = (data: { servers: { name: string; online: boolean; toolCount: number }[]; toolInfos: { name: string; source: string; description: string; online: boolean }[] }) => void;

import { TaskFailureCodes, WsMessages } from "@atom-neo/shared";

type PendingRequest = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  text: string;
  rootTaskId: string;
};

export class TuiTaskError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    if (code === TaskFailureCodes.PipelineAborted) this.name = "TaskCancelledError";
    if (code === TaskFailureCodes.ApiKeyInvalid) this.name = "ApiKeyInvalidError";
  }
}

export class TuiClient {
  #url: string;
  #sessionId: string;
  #chatId: string;
  #ws: WebSocket | null = null;
  #ready = false;
  #onDelta?: DeltaCallback;
  #onReason?: ReasonCallback;
  #onTool?: ToolCallback;
  #onToolStep?: ToolStepCallback;
  #onToolGroupComplete?: ToolGroupCompleteCallback;
  #onContextTokens?: ContextTokensCallback;
  #onBusyChange?: BusyChangeCallback;
  #onMCPStatus?: MCPStatusCallback;
  #onMCPConnected?: MCPConnectedCallback;
  #activeTaskIds: Set<string> = new Set();
  #pending: PendingRequest[] = [];

  constructor(params: { url?: string; sessionId?: string; chatId?: string } = {}) {
    this.#url = (params.url ?? "http://127.0.0.1:3100").replace(/^http/, "ws");
    this.#sessionId = params.sessionId ?? `tui-${Date.now()}`;
    this.#chatId = params.chatId ?? "default";
  }

  get sessionId(): string { return this.#sessionId; }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#ws = new WebSocket(`${this.#url}/ws/${encodeURIComponent(this.#sessionId)}`);

      this.#ws.onopen = () => {};

      this.#ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          const p = msg.payload ?? {};
          const t = msg.type as string;

          const handle = (handlers as any)[t];
          if (handle) handle(p);
        } catch { /* ignore */ }
      };

      const handlers: Record<string, (p: Record<string, any>) => void> = {
        [WsMessages.Server.SessionReady]: () => {
          this.#ready = true;
          resolve();
        },
        [WsMessages.Server.TransportDelta]: (p) => {
          const delta = p.textDelta ?? "";
          const offset = p.offset ?? 0;
          if (delta) {
            const head = this.#pending[0];
            if (head) head.text += delta;
            this.#onDelta?.(delta, offset);
          }
        },
        [WsMessages.Server.TransportReason]: (p) => {
          const delta = p.textDelta ?? "";
          if (delta) this.#onReason?.(delta, p.offset ?? 0);
        },
        [WsMessages.Server.TransportToolStarted]: (p) => {
          this.#onTool?.({ name: p.toolName ?? "", callId: p.toolCallId ?? "", input: p.input });
        },
        [WsMessages.Server.TransportToolFinished]: (p) => {
          this.#onTool?.({ name: p.toolName ?? "", callId: p.toolCallId ?? "", result: p.result, error: p.error });
        },
        [WsMessages.Server.TransportToolStepFinished]: (p) => {
          this.#onToolStep?.({ total: p.total ?? 0, success: p.success ?? 0, failed: p.failed ?? 0, toolNames: p.toolNames ?? [] });
        },
        [WsMessages.Server.TransportToolGroupComplete]: (p) => {
          this.#onToolGroupComplete?.({ total: p.total ?? 0, success: p.success ?? 0, failed: p.failed ?? 0, toolNames: p.toolNames ?? [] });
        },
        [WsMessages.Server.TaskCompleted]: (p) => {
          if (p.terminal === true) {
            const index = this.#pending.findIndex(pending => pending.rootTaskId === p.rootTaskId);
            if (index >= 0) {
              const done = this.#pending.splice(index, 1)[0];
              done.resolve(done.text);
            }
          }
          const contextTokens = p.contextTokens ?? p.tokenUsage?.total;
          if (typeof contextTokens === "number") this.#onContextTokens?.(contextTokens);
        },
        [WsMessages.Server.TaskFailed]: (p) => {
          const rootTaskId = p.rootTaskId ?? p.taskId;
          const index = this.#pending.findIndex(pending => pending.rootTaskId === rootTaskId);
          if (index < 0) return;
          const pending = this.#pending.splice(index, 1)[0];
          const err = p.error ?? "Unknown error";
          const error = new TuiTaskError(String(err), typeof p.code === "string" ? p.code : undefined);
          pending.reject(error);
        },
        [WsMessages.Server.SessionTaskActive]: (p) => {
          const { active, taskId } = p;
          if (active === false) {
            this.#activeTaskIds.delete(taskId ?? "");
          } else {
            this.#activeTaskIds.add(taskId ?? "");
          }
          this.#onBusyChange?.(this.#activeTaskIds.size > 0);
        },
        [WsMessages.Server.MCPToolStatus]: (p) => {
          const servers = p.servers ?? [];
          if (servers.length > 0) this.#onMCPStatus?.(servers);
        },
        [WsMessages.Server.MCPConnected]: (p) => {
          this.#onMCPConnected?.({ servers: p.servers ?? [], toolInfos: p.toolInfos ?? [] });
        },
      };

      this.#ws.onerror = () => reject(new Error("WebSocket connection failed"));
      this.#ws.onclose = () => { this.#ready = false; };
    });
  }

  async send(text: string): Promise<string> {
    if (!this.#ws || !this.#ready) throw new Error("Not connected");

    const httpUrl = this.#url.replace(/^ws/, "http");
    const res = await fetch(`${httpUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: this.#sessionId, chatId: this.#chatId, data: { text },
      }),
    });
    const response = await res.json().catch(() => ({})) as { taskId?: unknown; error?: unknown };
    if (!res.ok) throw new Error(String(response.error ?? `Task submission failed (${res.status})`));
    if (typeof response.taskId !== "string" || !response.taskId) {
      throw new Error("Invalid task submission response");
    }
    const taskId = response.taskId;

    return new Promise<string>((resolve, reject) => {
      this.#pending.push({ resolve, reject, text: "", rootTaskId: taskId });
    });
  }

  onDelta(cb: DeltaCallback): void { this.#onDelta = cb; }
  onReason(cb: ReasonCallback): void { this.#onReason = cb; }
  onTool(cb: ToolCallback): void { this.#onTool = cb; }
  onToolStepFinish(cb: ToolStepCallback): void { this.#onToolStep = cb; }
  onToolGroupComplete(cb: ToolGroupCompleteCallback): void { this.#onToolGroupComplete = cb; }
  onContextTokens(cb: ContextTokensCallback): void { this.#onContextTokens = cb; }
  onBusyChange(cb: BusyChangeCallback): void { this.#onBusyChange = cb; }
  onMCPStatus(cb: MCPStatusCallback): void { this.#onMCPStatus = cb; }
  onMCPConnected(cb: MCPConnectedCallback): void { this.#onMCPConnected = cb; }

  close(): void {
    for (const p of this.#pending) p.reject(new Error("Connection closed"));
    this.#pending = [];
    this.#activeTaskIds.clear();
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
