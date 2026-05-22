import type { LogSink, LogEntry } from "../types";

export class FileSink implements LogSink {
  #path: string;
  #queue: string[] = [];
  #flushing = false;

  constructor(path: string) {
    this.#path = path;
  }

  write(entry: LogEntry): void {
    const ts = new Date(entry.timestamp).toISOString();
    const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
    this.#queue.push(`[${ts}] ${entry.level.toUpperCase()}: ${entry.message}${ctx}\n`);
    this.#flush();
  }

  async #flush(): Promise<void> {
    if (this.#flushing) return;
    this.#flushing = true;

    while (this.#queue.length > 0) {
      const line = this.#queue.shift()!;
      await Bun.file(this.#path).write(line);
    }

    this.#flushing = false;
  }
}
