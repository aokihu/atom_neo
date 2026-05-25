import { Logger, StdoutSink, LogHub, FileSink, PipeSink } from "@atom-neo/shared";
import type { LogLevel } from "@atom-neo/shared";
import { parseArguments } from "./bootstrap/cli";
import type { BootArguments } from "./bootstrap/cli";
import { loadConfig } from "./bootstrap/config";
import { loadEnv } from "./bootstrap/env";
import { initAtomDir, initAgentsMd } from "./bootstrap/agents";
import { RuntimeService } from "./services/runtime-service";
import { ServiceManager } from "./services/service-manager";
import { AgentsCompilerService } from "./services/agents-compiler";
import { MemoryService } from "./services/memory-service";

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
  // Must set BEFORE AI SDK (via @atom-neo/core) is imported
  (globalThis as any).AI_SDK_LOG_WARNINGS = false;

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
  sm.register("memory", new MemoryService({
    dbPath: runtime.atomDir + "/memory/memory.db",
    nodesPath: runtime.atomDir + "/memory/nodes",
  }));
  sm.startAll();

  // Lazy import to ensure AI_SDK_LOG_WARNINGS is set before AI SDK loads
  const { startCore } = await import("@atom-neo/core");

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
