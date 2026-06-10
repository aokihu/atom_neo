import type { LogSink, LogEntry } from "../types";
import { appendFileSync } from "node:fs";

export class FileSink implements LogSink {
  #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  write(entry: LogEntry): void {
    const ts = new Date(entry.timestamp).toISOString();
    const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
    const line = `[${ts}] ${entry.level.toUpperCase()}: ${entry.message}${ctx}\n`;
    appendFileSync(this.#path, line);
  }
}
