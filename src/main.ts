import { statSync } from "node:fs";
import { Logger, StdoutSink, LogHub, FileSink, PipeSink } from "@atom-neo/shared";
import type { LogLevel } from "@atom-neo/shared";
import { parseArguments, printHelp } from "./bootstrap/cli";
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

function isFifo(path: string): boolean {
  try { return statSync(path).isFIFO(); } catch { return false; }
}

function createLogger(args: BootArguments) {
  if (args.logModes.length === 0) {
    return new Logger(args.logLevel, () => {});
  }

  const hub = new LogHub();

  for (const mode of args.logModes) {
    switch (mode) {
      case "console":
        if (args.mode === "core") hub.addSink(new StdoutSink());
        break;
      case "pipe":
        if (args.logPipePath && isFifo(args.logPipePath)) {
          hub.addSink(new PipeSink(args.logPipePath));
        }
        break;
      case "file":
        if (args.logFile) hub.addSink(new FileSink(args.logFile));
        break;
    }
  }

  return new Logger(args.logLevel, (entry) => {
    if (shouldLog(entry.level, args.logLevel, args.logIgnore)) {
      hub.write(entry);
    }
  });
}

export async function main(): Promise<void> {
  const parsed = parseArguments(Bun.argv.slice(2));
  if (parsed === "help") {
    printHelp();
    process.exit(0);
  }
  const args = parsed;

  // Must set BEFORE AI SDK (via @atom-neo/core) is imported
  (globalThis as any).AI_SDK_LOG_WARNINGS = false;

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

  const port = args.port || 3100;

  // Default (no --mode): core + TUI
  if (!args.mode) {
    const core = await startCore({ port, host: args.host, logger, sm });
    const { startTui } = await import("@atom-neo/tui");
    await startTui({ url: `http://${args.host}:${core.port}` });
    return;
  }

  // Explicit --mode: core or full
  switch (args.mode) {
    case "core":
    case "full":
      await startCore({ port, host: args.host, logger, sm });
      break;
  }
}

if (import.meta.main) {
  main();
}
