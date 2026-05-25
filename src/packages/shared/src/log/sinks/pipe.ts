import type { LogSink, LogEntry } from "../types";
import { openSync, writeSync, closeSync } from "node:fs";

const O_WRONLY = 1;
const O_NONBLOCK = 0o4000;

export class PipeSink implements LogSink {
  #fd: number | null = null;
  #path: string;

  constructor(pipePath: string) {
    this.#path = pipePath;
  }

  write(entry: LogEntry): void {
    if (this.#fd === null) {
      try {
        this.#fd = openSync(this.#path, O_WRONLY | O_NONBLOCK);
      } catch {
        return;
      }
    }

    const ts = new Date(entry.timestamp).toISOString();
    const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
    const line = `[${ts}] ${entry.level.toUpperCase()}: ${entry.message}${ctx}\n`;

    try {
      writeSync(this.#fd, line);
    } catch {
      try { closeSync(this.#fd); } catch {}
      this.#fd = null;
    }
  }
}
