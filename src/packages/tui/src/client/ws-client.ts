type DeltaCallback = (delta: string) => void;
type ToolCallback = (event: { name: string; callId: string; input?: unknown; result?: unknown; error?: unknown }) => void;
type TokenUsageCallback = (total: number) => void;

type PendingRequest = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  text: string;
};

export class TuiClient {
  #url: string;
  #sessionId: string;
  #chatId: string;
  #ws: WebSocket | null = null;
  #ready = false;
  #onDelta?: DeltaCallback;
  #onTool?: ToolCallback;
  #onTokenUsage?: TokenUsageCallback;
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
          if (msg.type === "session.ready") {
            this.#ready = true;
            resolve();
          } else if (msg.type === "event.transport.delta") {
            const delta = msg.payload?.textDelta ?? "";
            if (delta) {
              const head = this.#pending[0];
              if (head) head.text += delta;
              this.#onDelta?.(delta);
            }
          } else if (msg.type === "event.transport.tool.started") {
            this.#onTool?.({
              name: msg.payload?.toolName ?? "",
              callId: msg.payload?.toolCallId ?? "",
              input: msg.payload?.input,
            });
          } else if (msg.type === "event.transport.tool.finished") {
            this.#onTool?.({
              name: msg.payload?.toolName ?? "",
              callId: msg.payload?.toolCallId ?? "",
              result: msg.payload?.result,
              error: msg.payload?.error,
            });
          } else if (msg.type === "event.task.completed") {
            const pending = this.#pending.shift();
            if (pending) pending.resolve(pending.text);
            const tu = msg.payload?.tokenUsage;
            if (tu) this.#onTokenUsage?.(tu.total);
          } else if (msg.type === "event.task.failed") {
            const pending = this.#pending.shift();
            const err = msg.payload?.error ?? "Unknown error";
            if (pending) pending.reject(new Error(String(err)));
          }
        } catch { /* ignore */ }
      };

      this.#ws.onerror = () => reject(new Error("WebSocket connection failed"));
      this.#ws.onclose = () => { this.#ready = false; };
    });
  }

  async send(text: string): Promise<string> {
    if (!this.#ws || !this.#ready) throw new Error("Not connected");

    const httpUrl = this.#url.replace(/^ws/, "http");
    await fetch(`${httpUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: this.#sessionId, chatId: this.#chatId, data: { text },
      }),
    });

    return new Promise<string>((resolve, reject) => {
      this.#pending.push({ resolve, reject, text: "" });
    });
  }

  onDelta(cb: DeltaCallback): void { this.#onDelta = cb; }
  onTool(cb: ToolCallback): void { this.#onTool = cb; }
  onTokenUsage(cb: TokenUsageCallback): void { this.#onTokenUsage = cb; }

  close(): void {
    for (const p of this.#pending) p.reject(new Error("Connection closed"));
    this.#pending = [];
    this.#ws?.close();
  }
}
