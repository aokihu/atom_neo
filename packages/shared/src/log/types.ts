export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
};

export type LogSink = {
  write(entry: LogEntry): void;
};
