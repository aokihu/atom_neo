import type { LogSink, LogEntry } from "../types";

export class StdoutSink implements LogSink {
  write(entry: LogEntry): void {
    const ts = new Date(entry.timestamp).toISOString();
    const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
    console.log(`[${ts}] ${entry.level.toUpperCase()}: ${entry.message}${ctx}`);
  }
}
