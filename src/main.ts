import { statSync } from "node:fs";
import { Logger, StdoutSink, LogHub, FileSink, PipeSink } from "@atom-neo/shared";
import type { LogLevel } from "@atom-neo/shared";
import { VERSION } from "./version";
import { parseArguments, printHelp } from "./bootstrap/cli";
import type { BootArguments } from "./bootstrap/cli";
import { loadConfig } from "./bootstrap/config";
import { loadEnv } from "./bootstrap/env";
import { initAtomDir, initAgentsMd } from "./bootstrap/agents";
import { isFirstRun, runFirstRunWizard, markInstalled } from "./bootstrap/first-run";
import { RuntimeService } from "./services/runtime-service";
import { ServiceManager } from "./services/service-manager";
import { AgentsCompilerService } from "./services/agents-compiler";
import { MemoryService } from "./services/memory-service";
import { SkillService } from "./services/skill-service";
import { resolveContextLimit } from "./packages/core/src/constants";

declare global {
  var AI_SDK_LOG_WARNINGS: boolean;
}

function isFifo(path: string): boolean {
  try { return statSync(path).isFIFO(); } catch { return false; }
}

function createLogger(args: BootArguments) {
  if (args.logModes.length === 0) {
    return new Logger(args.logLevel, () => {}, args.logIgnore);
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

  return new Logger(args.logLevel, (entry) => hub.write(entry), args.logIgnore);
}

export async function main(): Promise<void> {
  const parsed = parseArguments(Bun.argv.slice(2));
  if (parsed === "help") {
    printHelp();
    process.exit(0);
  }
  const args = parsed;

  // Must set BEFORE AI SDK (via @atom-neo/core) is imported
  globalThis.AI_SDK_LOG_WARNINGS = false;

  // --wizard subprocess: run setup wizard and exit
  if (Bun.argv.includes("--wizard")) {
    const sandboxIdx = Bun.argv.indexOf("--sandbox");
    const wizardSandbox = sandboxIdx >= 0 ? Bun.argv[sandboxIdx + 1] ?? process.cwd() : process.cwd();
    const { runWizard } = await import("@atom-neo/setup-wizard");
    await runWizard(wizardSandbox);
    return;
  }

  // Bootstrap
  loadEnv(args.sandbox);
  let appConfig = loadConfig(args.sandbox);
  if (!args.logLevelExplicit) args.logLevel = appConfig.log?.level ?? args.logLevel;
  if (!args.logIgnoreExplicit) args.logIgnore = appConfig.log?.ignore ?? args.logIgnore;
  const logger = createLogger(args);
  logger.info("booting", { mode: args.mode, sandbox: args.sandbox, port: args.port });
  logger.debug("log level active", { level: args.logLevel, ignore: args.logIgnore });

  // First-Run Detection
  if (isFirstRun(args.sandbox)) {
    logger.info("first run detected, launching setup wizard");
    await runFirstRunWizard(args.sandbox);
    markInstalled(args.sandbox);
    loadEnv(args.sandbox);
    appConfig = loadConfig(args.sandbox);
    if (!args.logLevelExplicit) args.logLevel = appConfig.log?.level ?? args.logLevel;
  }

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
  const sm = new ServiceManager({ logger });
  sm.register("agents-compiler", new AgentsCompilerService({ runtime }));
  sm.register("memory", new MemoryService({
    dbPath: runtime.atomDir + "/memory/memory.db",
    nodesPath: runtime.atomDir + "/memory/nodes",
  }));
  sm.register("skill", new SkillService({ sandbox: args.sandbox }));
  sm.startAll();

  // Lazy import to ensure AI_SDK_LOG_WARNINGS is set before AI SDK loads
  const { startCore } = await import("@atom-neo/core");

  const port = args.port || 3100;

  // Default (no --mode): core + TUI
  if (!args.mode) {
    const core = await startCore({ port, host: args.host, logger, sm, runtime });
    const { startTui } = await import("@atom-neo/tui");
    const resolved = runtime.getResolvedModel("balanced");
    try {
      await startTui({
        url: `http://${args.host}:${core.port}`,
        serverInfo: {
          port: core.port,
          host: args.host,
          model: resolved.model,
          sandbox: args.sandbox,
          version: VERSION,
          tools: core.tools,
          toolInfos: core.toolInfos,
          mcpServerInfos: core.mcpServerInfos,
          theme: appConfig.tui?.theme ?? "github-dark",
          contextLimit: resolveContextLimit(
            `${resolved.provider}/${resolved.model}`,
            appConfig?.providers?.[resolved.provider]?.contextLimit,
          ),
          thinking: resolved.thinking,
        },
      });
    } finally {
      core.stop();
    }
    return;
  }

  // Explicit --mode: core or full
  switch (args.mode) {
    case "core":
    case "full":
      await startCore({ port, host: args.host, logger, sm, runtime });
      break;
  }
}

if (import.meta.main) {
  main();
}
