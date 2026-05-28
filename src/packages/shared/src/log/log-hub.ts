import type { LogEntry, LogSink } from "./types";

export class LogHub {
  #sinks: Set<LogSink> = new Set();

  addSink(sink: LogSink): () => void {
    this.#sinks.add(sink);
    return () => this.#sinks.delete(sink);
  }

  write(entry: LogEntry): void {
    for (const sink of this.#sinks) {
      try {
        sink.write(entry);
      } catch (err) {
        console.error("[log-hub] sink write failed:", err instanceof Error ? err.message : String(err));
      }
    }
  }
}
