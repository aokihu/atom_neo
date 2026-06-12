import type { LogSink, LogEntry } from "../types";
import { appendFileSync } from "node:fs";
import { formatLogLine } from "./format";

export class FileSink implements LogSink {
  #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  write(entry: LogEntry): void {
    appendFileSync(this.#path, formatLogLine(entry) + "\n");
  }
}
