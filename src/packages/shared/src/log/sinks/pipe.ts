import type { LogSink, LogEntry } from "../types";
import { closeSync, constants, openSync, writeSync } from "node:fs";
import { formatLogLine } from "./format";

export class PipeSink implements LogSink {
  #fd: number | null = null;
  #path: string;

  constructor(pipePath: string) {
    this.#path = pipePath;
  }

  write(entry: LogEntry): void {
    if (this.#fd === null) {
      try {
        this.#fd = openSync(this.#path, constants.O_WRONLY | constants.O_NONBLOCK);
      } catch {
        return;
      }
    }

    const line = formatLogLine(entry) + "\n";

    try {
      writeSync(this.#fd, line);
    } catch {
      try { closeSync(this.#fd); } catch {}
      this.#fd = null;
    }
  }
}
