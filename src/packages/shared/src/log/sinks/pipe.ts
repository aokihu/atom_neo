import type { LogSink, LogEntry } from "../types";

export class PipeSink implements LogSink {
  #callbacks: Set<(entry: LogEntry) => void> = new Set();

  on(writer: (entry: LogEntry) => void): () => void {
    this.#callbacks.add(writer);
    return () => this.#callbacks.delete(writer);
  }

  write(entry: LogEntry): void {
    for (const cb of this.#callbacks) {
      try {
        cb(entry);
      } catch {
        // Ignore callback errors
      }
    }
  }
}
