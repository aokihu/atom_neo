import { Logger, StdoutSink, LogHub, FileSink, PipeSink } from "@atom-neo/shared";
import type { LogLevel } from "@atom-neo/shared";
import { parseArguments } from "./bootstrap/cli";
import type { BootArguments } from "./bootstrap/cli";
import { loadConfig } from "./bootstrap/config";
import { loadEnv } from "./bootstrap/env";
import { startCore } from "@atom-neo/core";
import { setSandbox, setBashSandbox } from "@atom-neo/core";
import { initAtomDir, initAgentsMd } from "./bootstrap/agents";
import { ServiceManager } from "./services/service-manager";
import { AgentsCompilerService } from "./services/agents-compiler";

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];

function shouldLog(level: LogLevel, minLevel: LogLevel, ignores: LogLevel[]): boolean {
  if (ignores.includes(level)) return false;
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(minLevel);
}

function createLogger(args: BootArguments) {
  const hub = new LogHub();

  if (args.mode === "core") {
    if (args.logFile || args.logPipePath) {
      // --log-file or --log-pipepath suppresses console
    } else {
      hub.addSink(new StdoutSink());
    }
  }

  if (args.logPipePath) {
    hub.addSink(new PipeSink());
  }
  if (args.logFile) {
    hub.addSink(new FileSink(args.logFile));
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
  initAtomDir(args.sandbox);
  initAgentsMd(args.sandbox);

  const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "";

  // Services
  const serviceManager = new ServiceManager();
  const compiler = new AgentsCompilerService({
    sandbox: args.sandbox,
    apiKey,
  });
  serviceManager.register("agents-compiler", compiler);
  serviceManager.startAll();

  const getCompiledPrompt = () => serviceManager.getCompiledAgentsPrompt();

  // Dispatch by mode
  switch (args.mode) {
    case "core":
      await startCore({
        port: args.port,
        host: args.host,
        sandbox: args.sandbox,
        logger,
        apiKey,
        getCompiledPrompt,
      });
      break;
    case "tui":
      logger.error("TUI mode not yet implemented");
      break;
    case "full":
      await startCore({
        port: args.port,
        host: args.host,
        sandbox: args.sandbox,
        logger,
        apiKey,
        getCompiledPrompt,
      });
      break;
  }
}

if (import.meta.main) {
  main();
}
