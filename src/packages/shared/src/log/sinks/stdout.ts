import type { LogSink, LogEntry } from "../types";
import { formatLogLine } from "./format";

export class StdoutSink implements LogSink {
  write(entry: LogEntry): void {
    console.log(formatLogLine(entry));
  }
}
