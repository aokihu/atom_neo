/**
 * Core composition root and HTTP/WebSocket lifecycle.
 * Transport details live behind the injected `HttpServer` adapter.
 */
import { BusEvents, createHttpServer } from "@atom-neo/shared";
import type { HttpServer, HttpServerHandle } from "@atom-neo/shared";
import { createCoreBootstrap } from "./bootstrap";
import type { CoreDeps } from "./bootstrap";
import { resolveCoreServices } from "./core-services";
import { createHttpRouter } from "./http-router";

export type { CoreDeps } from "./bootstrap";
export type { CoreServices, MemoryServiceLike } from "./core-services";
export { resolveTaskFailureCode } from "./task-lifecycle";

type CoreHandle = {
  port: number;
  tools: string[];
  toolInfos: { name: string; source: string; description: string; online?: boolean }[];
  mcpServerInfos: { name: string; online: boolean; toolCount: number }[];
  stop: () => Promise<void>;
};

/** Start the core HTTP + WebSocket server with AI pipeline processing. */
export async function startCore(deps: CoreDeps & { httpServer?: HttpServer }): Promise<CoreHandle> {
  const { port, host, logger } = deps;
  const services = resolveCoreServices({ services: deps.services });
  const httpServer = deps.httpServer ?? await createHttpServer();
  const stopping = { value: false };
  const isStopping = () => stopping.value;
  const core = createCoreBootstrap({ ...deps, services, isStopping });
  const router = createHttpRouter({
    logger,
    adminToken: deps.adminToken,
    allowRemoteAdmin: deps.allowRemoteAdmin,
    version: deps.version,
    host,
    sandbox: deps.runtime.sandbox ?? "",
    runtime: deps.runtime,
    fallbackModel: core.fallbackModel,
    sessionStore: core.sessionStore,
    taskQueue: core.taskQueue,
    taskEngine: core.taskEngine,
    taskSubmission: core.taskSubmission,
    orchestrator: core.orchestrator,
    hookManager: core.hookManager,
    allTools: core.allTools,
    toolInfos: core.toolInfos,
    getMcpServerInfos: core.getMcpServerInfos,
    budgetLimits: core.budgetLimits,
    isStopping,
  });

  let handle: HttpServerHandle | undefined;
  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      stopping.value = true;
      clearInterval(core.sessionSweepTimer);
      handle?.stop(false);
      core.hookManager.stop();
      core.scheduleService.stop();
      for (const task of core.taskQueue.getHookTasks()) core.taskEngine.cancel(task.id, task.sessionId);
      await core.backgroundShell.stop();
      while (!await core.taskEngine.drain({ timeoutMs: 30_000 })) {
        logger.warn("waiting for queued and active tasks before shutdown");
      }
      core.sessionStore.suspendAll("shutdown");
      const failedCheckpoints = core.sessionStore.size;
      if (failedCheckpoints > 0) {
        logger.error("session checkpoint failed during shutdown", { remaining: failedCheckpoints });
        throw new Error(`Failed to persist ${failedCheckpoints} session(s) during shutdown`);
      }
      core.mcp.stopHealth();
      core.bus.emit(BusEvents.Context.CoreStopped, {});
      core.contextService.stop();
      await core.mcp.close();
      await handle?.stop(true);
    })().catch(error => {
      stopPromise = null;
      throw error;
    });
    return stopPromise;
  };

  try {
    handle = await httpServer.serve({
      port,
      host,
      fetch: router.fetch,
      upgrade: router.upgrade,
      websocket: core.wsHandlers,
    });
  } catch (error) {
    await stop();
    throw error;
  }

  logger.info("core ready", { port: handle.port, address: host });
  return {
    port: handle.port,
    tools: core.allTools.map(t => t.name),
    toolInfos: core.toolInfos,
    mcpServerInfos: core.getMcpServerInfos(),
    stop,
  };
}
