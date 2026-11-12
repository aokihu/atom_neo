import { localUrl, publishRuntimeFile, readRuntimeFile, readAttachToken } from "./bootstrap/runtime-file";
import { statSync } from "node:fs";
import type { LogWarningsFunction } from "ai";
import { Logger, StdoutSink, LogHub, FileSink, PipeSink, createHttpServer, resolveHttpRuntime } from "@atom-neo/shared";
import type { HttpServer, LogLevel } from "@atom-neo/shared";
import type { CoreServices } from "@atom-neo/core";
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
import { formatMenuCommand, MenuFlow } from "./bootstrap/menu-flow";
import { readMenuHistory, saveMenuHistory } from "./bootstrap/menu-history";

declare global {
  var AI_SDK_LOG_WARNINGS: LogWarningsFunction | false | undefined;
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
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed === "help") {
    printHelp();
    process.exit(0);
  }
  const args = parsed;

  if (args.menu) {
    const { startMenu } = await import("./bootstrap/menu");
    const history = readMenuHistory();
    const flow = new MenuFlow(args, history.commands);
    flow.error = history.warning ?? "";
    while (true) {
      const request = await startMenu(flow);
      if (!request) return;
      try {
        console.log(`执行命令: ${formatMenuCommand(request.args)}`);
        await runApp(request.args, () => {
          try { saveMenuHistory(request.command, request.parameters); }
          catch (error) { console.error(`Cannot save menu history: ${error instanceof Error ? error.message : String(error)}`); }
        });
        return;
      } catch (error) {
        flow.error = error instanceof Error ? error.message : String(error);
      }
    }
  }
  await runApp(args);
}

async function runApp(args: BootArguments, onReady: () => void = () => {}): Promise<void> {

  // Must set BEFORE AI SDK (via @atom-neo/core) is imported
  globalThis.AI_SDK_LOG_WARNINGS = false;

  // export / import: standalone CLI or menu action, never loads Core
  if (args.command) {
    const { runBackupCommand } = await import("./bootstrap/backup");
    await runBackupCommand(args);
    onReady();
    return;
  }

  // --wizard subprocess: run setup wizard and exit
  if (args.wizard) {
    const { startWizard } = await import("@atom-neo/config-tui");
    await startWizard(args.sandbox, "first-run");
    return;
  }

  // --config: standalone config wizard (edit config.json + .env) and exit
  if (args.config) {
    const { startWizard } = await import("@atom-neo/config-tui");
    if (await startWizard(args.sandbox, "config")) onReady();
    return;
  }

  if (args.mode === "tui") {
    const host = args.coreServer!;
    loadEnv(args.sandbox);
    const token = readAttachToken(args.sandbox, host, process.env.ATOM_ADMIN_TOKEN);
    await attachTui(localUrl(host, args.corePort!), token, args.continueSession, args.sandbox, onReady);
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
    if (!response.ok) throw new Error(`Gateway control failed: ${JSON.stringify(result)}`);
    console.log(JSON.stringify(result, null, 2));
    onReady();
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

  // TUI-only admin token: config endpoints reject any caller without it (gateway/clients never receive it)
  const remoteAdminToken = process.env.ATOM_ADMIN_TOKEN?.trim();
  const adminToken = remoteAdminToken || crypto.randomUUID();

  // Runtime
  const runtime = new RuntimeService({
    mode: args.mode,
    port: args.port,
    host: args.host,
    sandbox: args.sandbox,
    config: loaded,
  });

  // Services
  const sm = new ServiceManager({ logger });
  const compiler = new AgentsCompilerService({ runtime });
  const memory = new MemoryService({
    dbPath: runtime.atomDir + "/memory/memory.db",
    legacyNodesPath: runtime.atomDir + "/memory/nodes",
  });
  const skill = new SkillService({ sandbox: args.sandbox });
  const network = new NetworkService();
  sm.register("agents-compiler", compiler);
  sm.register("memory", memory);
  sm.register("skill", skill);
  sm.register("network", network);
  const services: CoreServices = { memory, network, skill, compiler };
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
    const runtimeKind = resolveHttpRuntime();
    logger.info("http runtime selected", { runtime: runtimeKind });
    const httpServer: HttpServer = await createHttpServer(runtimeKind);
    await sm.startAll();
    const { startCore } = await import("@atom-neo/core");
    core = await startCore({ port: args.port, host: args.host, logger, services, runtime, adminToken, allowRemoteAdmin: !!remoteAdminToken, version: VERSION, httpServer });
    const url = localUrl(args.host, core.port);
    cleanupFiles.push(publishRuntimeFile(args.sandbox, "core", { url, token: adminToken, instanceId: crypto.randomUUID() }));
    if (args.mode === "core-gateway" || args.mode === "full") {
      const { startGateway } = await import("@atom-neo/gateway");
      const gatewayToken = crypto.randomUUID();
      gateway = await startGateway({ port: appConfig.gateway?.port ?? 3000, coreUrl: url, clients: appConfig.gateway?.clients, adminToken: gatewayToken, logger, httpServer });
      cleanupFiles.push(publishRuntimeFile(args.sandbox, "gateway", { url: localUrl("127.0.0.1", gateway.port), token: gatewayToken, instanceId: crypto.randomUUID() }));
    }
    const onSignal = () => { void shutdown().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); };
    process.once("SIGTERM", onSignal);
    if (args.mode) process.once("SIGINT", onSignal);
    if (args.mode) onReady();
    if (!args.mode) {
      try { await attachTui(url, adminToken, args.continueSession, args.sandbox, onReady); }
      finally { process.removeListener("SIGTERM", onSignal); await shutdown(); }
    }
  } catch (error) {
    await shutdown();
    throw error;
  }
}

async function attachTui(url: string, adminToken: string, continueSession: boolean, historySandbox: string, onReady: () => void): Promise<void> {
  const response = await fetch(`${url}/api/tui/attach`, {
    method: "POST", headers: { "x-atom-admin-token": adminToken, "Content-Type": "application/json" },
    body: JSON.stringify({ continue: continueSession }), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Cannot attach Core (${response.status}); check sandbox and running instance`);
  const data = await response.json() as { sessionId: string; serverInfo: import("@atom-neo/tui").ServerInfo };
  if (typeof data.sessionId !== "string" || !data.sessionId || !data.serverInfo || typeof data.serverInfo !== "object") {
    throw new Error("Core returned an invalid attach response");
  }
  onReady();
  const { startTui } = await import("@atom-neo/tui");
  await startTui({ url, adminToken, historySandbox, sessionId: data.sessionId, serverInfo: data.serverInfo });
}

if (import.meta.main) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
