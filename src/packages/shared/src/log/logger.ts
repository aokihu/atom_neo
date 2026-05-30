import type { LogLevel, LogEntry } from "./types";

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];

export class Logger {
  #level: LogLevel;
  #ignores: Set<LogLevel>;
  #writer: (entry: LogEntry) => void;

  constructor(
    level: LogLevel = "debug",
    writer: (entry: LogEntry) => void,
    ignores: LogLevel[] = [],
  ) {
    this.#level = level;
    this.#ignores = new Set(ignores);
    this.#writer = writer;
  }

  #shouldLog(level: LogLevel): boolean {
    if (this.#ignores.has(level)) return false;
    return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(this.#level);
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
