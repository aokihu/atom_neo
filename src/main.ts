import { Logger, StdoutSink, LogHub, FileSink, PipeSink } from "@atom-neo/shared";
import type { LogLevel } from "@atom-neo/shared";
import { parseArguments } from "./bootstrap/cli";
import type { BootArguments } from "./bootstrap/cli";
import { loadConfig } from "./bootstrap/config";
import { loadEnv } from "./bootstrap/env";
import { startCore } from "@atom-neo/core";
import { initAtomDir, initAgentsMd } from "./bootstrap/agents";
import { RuntimeService } from "./services/runtime-service";
import { ServiceManager } from "./services/service-manager";
import { AgentsCompilerService } from "./services/agents-compiler";

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];

function shouldLog(level: LogLevel, minLevel: LogLevel, ignores: LogLevel[]): boolean {
  if (ignores.includes(level)) return false;
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(minLevel);
}

function createLogger(args: BootArguments) {
  const hub = new LogHub();
  if (args.mode === "core" && !args.logFile && !args.logPipePath) {
    hub.addSink(new StdoutSink());
  }
  if (args.logPipePath) hub.addSink(new PipeSink());
  if (args.logFile) hub.addSink(new FileSink(args.logFile));
  return new Logger(args.logLevel, (entry) => {
    if (shouldLog(entry.level, args.logLevel, args.logIgnore)) {
      hub.write(entry);
    }
  });
}

export async function main(): Promise<void> {
  const args = parseArguments(Bun.argv.slice(2));

  // Bootstrap
  loadEnv(args.sandbox);
  const appConfig = loadConfig(args.sandbox);
  const logger = createLogger(args);
  logger.info("booting", { mode: args.mode, sandbox: args.sandbox, port: args.port });

  initAtomDir(args.sandbox);
  initAgentsMd(args.sandbox);

  const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "";

  // Runtime
  const runtime = new RuntimeService({
    mode: args.mode,
    port: args.port,
    host: args.host,
    sandbox: args.sandbox,
    apiKey,
    appConfig,
  });

  // Services
  const sm = new ServiceManager();
  sm.register("runtime", runtime);
  sm.register("agents-compiler", new AgentsCompilerService({ runtime }));
  sm.startAll();

  // Dispatch
  switch (args.mode) {
    case "core":
      await startCore({ port: args.port, host: args.host, logger, sm });
      break;
    case "tui":
      logger.error("TUI mode not yet implemented");
      break;
    case "full":
      await startCore({ port: args.port, host: args.host, logger, sm });
      break;
  }
}

if (import.meta.main) {
  main();
}
