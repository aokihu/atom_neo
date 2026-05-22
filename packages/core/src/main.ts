import { Logger, StdoutSink, LogHub, FileSink, PipeSink } from "@atom-neo/shared";
import type { LogLevel } from "@atom-neo/shared";
import { parseArguments } from "./cli";
import type { BootArguments } from "./cli";
import { loadConfig, loadEnv } from "./config";
import { startCore } from "./server";
import { setSandbox } from "./tools/builtin/fs";
import { setBashSandbox } from "./tools/builtin/bash";

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];

function shouldLog(level: LogLevel, minLevel: LogLevel, ignores: LogLevel[]): boolean {
  if (ignores.includes(level)) return false;
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(minLevel);
}

function createLogger(args: BootArguments) {
  const hub = new LogHub();

  switch (args.logOutput) {
    case "console":
      hub.addSink(new StdoutSink());
      break;
    case "file":
      hub.addSink(new FileSink(`${args.sandbox}/logs/app.log`));
      break;
    case "pipe":
      if (args.logPipe) {
        hub.addSink(new PipeSink());
      } else {
        hub.addSink(new StdoutSink());
      }
      break;
  }

  return new Logger(args.logLevel, (entry) => {
    if (shouldLog(entry.level, args.logLevel, args.logIgnore)) {
      hub.write(entry);
    }
  });
}

export async function main(): Promise<void> {
  const args = parseArguments(Bun.argv.slice(2));

  // Setup
  loadEnv(args.sandbox);
  const appConfig = loadConfig(args.sandbox);
  const logger = createLogger(args);

  logger.info("booting", { mode: args.mode, sandbox: args.sandbox, port: args.port });

  setSandbox(args.sandbox);
  setBashSandbox(args.sandbox);

  const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "";

  // Dispatch by mode
  switch (args.mode) {
    case "core":
      await startCore({
        port: args.port,
        host: args.host,
        sandbox: args.sandbox,
        logger,
        apiKey,
      });
      break;
    case "tui":
      // TODO: start TUI
      logger.error("TUI mode not yet implemented");
      break;
    case "full":
      // TODO: start core + gateway + tui
      await startCore({
        port: args.port,
        host: args.host,
        sandbox: args.sandbox,
        logger,
        apiKey,
      });
      break;
  }
}

if (import.meta.main) {
  main();
}
