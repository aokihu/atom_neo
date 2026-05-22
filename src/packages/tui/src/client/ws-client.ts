const DEFAULT_URL = "http://127.0.0.1:3100";

export class TuiClient {
  #url: string;
  #sessionId: string;
  #chatId: string;

  constructor(params: { url?: string; sessionId?: string; chatId?: string } = {}) {
    this.#url = params.url ?? DEFAULT_URL;
    this.#sessionId = params.sessionId ?? `tui-${Date.now()}`;
    this.#chatId = params.chatId ?? "default";
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  async send(text: string): Promise<string> {
    const res = await fetch(`${this.#url}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: this.#sessionId,
        chatId: this.#chatId,
        data: { text },
      }),
    });

    const { taskId } = (await res.json()) as { taskId: string };

    // Poll until task completes
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const hr = await fetch(`${this.#url}/api/health`);
      const health: any = await hr.json();
      if (health.queue.processing === 0 && health.queue.waiting === 0) break;
    }

    // Get messages
    const mr = await fetch(`${this.#url}/api/sessions/${this.#sessionId}`);
    const messages = (await mr.json()) as Array<{ role: string; content: string }>;
    const last = messages.filter((m) => m.role === "assistant").pop();
    return last?.content ?? "(no response)";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
