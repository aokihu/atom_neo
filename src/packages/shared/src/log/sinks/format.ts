import type { LogEntry } from "../types";

export function formatLogLine(entry: LogEntry): string {
  const ts = new Date(entry.timestamp).toISOString();
  const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
  return `[${ts}] ${entry.level.toUpperCase()}: ${entry.message}${ctx}`;
}
