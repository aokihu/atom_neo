import { localUrl, publishRuntimeFile, readRuntimeFile } from "./bootstrap/runtime-file";
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
import { NetworkService } from "./services/network/network-service";

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
        if (args.mode && args.mode !== "tui") hub.addSink(new StdoutSink());
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
    const { startWizard } = await import("@atom-neo/config-tui");
    await startWizard(args.sandbox, "first-run");
    return;
  }

  // --config: standalone config wizard (edit config.json + .env) and exit
  if (args.config) {
    const { startWizard } = await import("@atom-neo/config-tui");
    await startWizard(args.sandbox, "config");
    return;
  }

  if (args.mode === "tui") {
    const host = args.coreServer!;
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("TUI admin attach currently requires a local Core server");
    const runtimeFile = readRuntimeFile(args.sandbox, "core");
    await attachTui(localUrl(host, args.corePort!), runtimeFile.token);
    return;
  }
  if (args.mode === "gateway") {
    const runtimeFile = readRuntimeFile(args.sandbox, "gateway");
    const response = await fetch(`${runtimeFile.url}/admin/clients`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-atom-admin-token": runtimeFile.token },
      body: JSON.stringify({ action: args.action, clientId: args.clients }),
      signal: AbortSignal.timeout(120_000),
    });
    const result = await response.json();
    console.log(JSON.stringify(result, null, 2));
    if (!response.ok) process.exitCode = 1;
    return;
  }

  // Bootstrap
  loadEnv(args.sandbox);
  let loaded = loadConfig(args.sandbox);
  let appConfig = loaded.effective;
  if (!args.logLevelExplicit) args.logLevel = appConfig.log?.level ?? args.logLevel;
  if (!args.logIgnoreExplicit) args.logIgnore = appConfig.log?.ignore ?? args.logIgnore;
  const logger = createLogger(args);
  logger.info("booting", { mode: args.mode, sandbox: args.sandbox, port: args.port });
  logger.debug("log level active", { level: args.logLevel, ignore: args.logIgnore });

  // First-Run Detection
  if (args.mode && Object.keys(appConfig.providers ?? {}).length === 0) throw new Error("Core requires provider configuration. Run --config with this sandbox first.");
  if (!args.mode && isFirstRun(args.sandbox)) {
    logger.info("first run detected, launching setup wizard");
    await runFirstRunWizard(args.sandbox);
    markInstalled(args.sandbox);
    loadEnv(args.sandbox);
    loaded = loadConfig(args.sandbox);
    appConfig = loaded.effective;
    if (!args.logLevelExplicit) args.logLevel = appConfig.log?.level ?? args.logLevel;
  }

  initAtomDir(args.sandbox);
  initAgentsMd(args.sandbox);

  const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  // TUI-only admin token: config endpoints reject any caller without it (gateway/clients never receive it)
  const adminToken = crypto.randomUUID();

  // Runtime
  const runtime = new RuntimeService({
    mode: args.mode,
    port: args.port,
    host: args.host,
    sandbox: args.sandbox,
    apiKey,
    config: loaded,
  });

  // Services
  const sm = new ServiceManager({ logger });
  sm.register("agents-compiler", new AgentsCompilerService({ runtime }));
  sm.register("memory", new MemoryService({
    dbPath: runtime.atomDir + "/memory/memory.db",
    legacyNodesPath: runtime.atomDir + "/memory/nodes",
  }));
  sm.register("skill", new SkillService({ sandbox: args.sandbox }));
  sm.register("network", new NetworkService());
  let core: Awaited<ReturnType<typeof import("@atom-neo/core").startCore>> | undefined;
  let gateway: Awaited<ReturnType<typeof import("@atom-neo/gateway").startGateway>> | undefined;
  const cleanupFiles: (() => void)[] = [];
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => shutdownPromise ??= (async () => {
    try {
      if (gateway) await gateway.stop();
    } finally {
      try { if (core) await core.stop(); }
      finally {
        try { await sm.stopAll(); }
        finally { for (const cleanup of cleanupFiles.reverse()) cleanup(); }
      }
    }
  })();
  try {
    await sm.startAll();
    const { startCore } = await import("@atom-neo/core");
    core = await startCore({ port: args.port, host: args.host, logger, sm, runtime, adminToken, version: VERSION });
    const url = localUrl(args.host, core.port);
    cleanupFiles.push(publishRuntimeFile(args.sandbox, "core", { url, token: adminToken, instanceId: crypto.randomUUID() }));
    if (args.mode === "core-gateway" || args.mode === "full") {
      const { startGateway } = await import("@atom-neo/gateway");
      const gatewayToken = crypto.randomUUID();
      gateway = await startGateway({ port: appConfig.gateway?.port ?? 3000, coreUrl: url, clients: appConfig.gateway?.clients, adminToken: gatewayToken });
      cleanupFiles.push(publishRuntimeFile(args.sandbox, "gateway", { url: localUrl("127.0.0.1", gateway.port), token: gatewayToken, instanceId: crypto.randomUUID() }));
    }
    const onSignal = () => { void shutdown().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); };
    process.once("SIGTERM", onSignal);
    if (args.mode) process.once("SIGINT", onSignal);
    if (!args.mode) {
      try { await attachTui(url, adminToken); }
      finally { process.removeListener("SIGTERM", onSignal); await shutdown(); }
    }
  } catch (error) {
    await shutdown();
    throw error;
  }
}

async function attachTui(url: string, adminToken: string): Promise<void> {
  const response = await fetch(`${url}/api/tui/attach`, {
    method: "POST", headers: { "x-atom-admin-token": adminToken }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Cannot attach Core (${response.status}); check sandbox and running instance`);
  const data = await response.json() as { sessionId: string; serverInfo: import("@atom-neo/tui").ServerInfo };
  const { startTui } = await import("@atom-neo/tui");
  await startTui({ url, adminToken, ...data });
}

if (import.meta.main) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
