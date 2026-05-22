import type { LogLevel, LogEntry } from "./types";

export class Logger {
  #level: LogLevel;
  #writer: (entry: LogEntry) => void;

  constructor(
    level: LogLevel = "info",
    writer: (entry: LogEntry) => void,
  ) {
    this.#level = level;
    this.#writer = writer;
  }

  #shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(this.#level);
  }

  #log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (!this.#shouldLog(level)) return;
    this.#writer({
      level,
      message,
      timestamp: Date.now(),
      context,
    });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.#log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.#log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.#log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.#log("error", message, context);
  }
}
