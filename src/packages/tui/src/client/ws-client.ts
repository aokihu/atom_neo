type StreamCallback = (delta: string) => void;

export class TuiClient {
  #url: string;
  #sessionId: string;
  #chatId: string;
  #ws: WebSocket | null = null;
  #ready = false;
  #onDelta?: StreamCallback;
  #responseResolve?: (text: string) => void;
  #responseText = "";

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
              this.#responseText += delta;
              this.#onDelta?.(delta);
            }
          } else if (msg.type === "event.task.completed") {
            this.#responseResolve?.(this.#responseText);
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
    const res = await fetch(`${httpUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: this.#sessionId, chatId: this.#chatId, data: { text },
      }),
    });

    // Wait for task.completed WebSocket event
    return new Promise<string>((resolve) => {
      this.#responseResolve = resolve;
      this.#responseText = "";
    });
  }

  onDelta(cb: StreamCallback): void {
    this.#onDelta = cb;
  }
}
