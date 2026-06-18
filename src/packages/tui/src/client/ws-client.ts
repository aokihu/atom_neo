type DeltaCallback = (delta: string, offset: number) => void;
type ReasonCallback = (delta: string, offset: number) => void;
type ToolCallback = (event: { name: string; callId: string; input?: unknown; result?: unknown; error?: unknown }) => void;
type ToolStepCallback = (event: { total: number; success: number; failed: number; toolNames: string[] }) => void;
type TokenUsageCallback = (total: number) => void;
type BusyChangeCallback = (busy: boolean) => void;

import { WsMessages } from "@atom-neo/shared";

type PendingRequest = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  text: string;
  rootTaskId: string;
};

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
  #onTokenUsage?: TokenUsageCallback;
  #onBusyChange?: BusyChangeCallback;
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
      this.#ws = new WebSocket(`${this.#url}/ws/${this.#sessionId}`);

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
        [WsMessages.Server.TaskCompleted]: (p) => {
          const { taskId: completedId, parentTaskId } = p;
          for (let i = 0; i < this.#pending.length; i++) {
            const head = this.#pending[i];
            if (parentTaskId === head.rootTaskId && completedId !== head.rootTaskId) {
              const done = this.#pending.splice(i, 1)[0];
              done.resolve(done.text);
              break;
            }
          }
          const tu = p.tokenUsage;
          if (tu) this.#onTokenUsage?.(tu.total);
        },
        [WsMessages.Server.TaskFailed]: (p) => {
          const pending = this.#pending.shift();
          const err = p.error ?? "Unknown error";
          if (pending) pending.reject(new Error(String(err)));
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
    const { taskId } = await res.json();

    return new Promise<string>((resolve, reject) => {
      this.#pending.push({ resolve, reject, text: "", rootTaskId: taskId });
    });
  }

  onDelta(cb: DeltaCallback): void { this.#onDelta = cb; }
  onReason(cb: ReasonCallback): void { this.#onReason = cb; }
  onTool(cb: ToolCallback): void { this.#onTool = cb; }
  onToolStepFinish(cb: ToolStepCallback): void { this.#onToolStep = cb; }
  onTokenUsage(cb: TokenUsageCallback): void { this.#onTokenUsage = cb; }
  onBusyChange(cb: BusyChangeCallback): void { this.#onBusyChange = cb; }

  close(): void {
    for (const p of this.#pending) p.reject(new Error("Connection closed"));
    this.#pending = [];
    this.#ws?.close();
  }
}
