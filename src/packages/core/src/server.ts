/**
 * Core composition root and Bun HTTP/WebSocket lifecycle.
 * Business logic lives in bootstrap/pipeline-factory/task-lifecycle/http-router/mcp-lifecycle.
 */
import { BusEvents } from "@atom-neo/shared";
import { createCoreBootstrap } from "./bootstrap";
import type { CoreDeps } from "./bootstrap";
import { createHttpRouter } from "./http-router";

export type { CoreDeps } from "./bootstrap";
export { resolveTaskFailureCode } from "./task-lifecycle";

type CoreHandle = {
  port: number;
  tools: string[];
  toolInfos: { name: string; source: string; description: string; online?: boolean }[];
  mcpServerInfos: { name: string; online: boolean; toolCount: number }[];
  stop: () => Promise<void>;
};

/** Start the core HTTP + WebSocket server with AI pipeline processing. */
export async function startCore(deps: CoreDeps): Promise<CoreHandle> {
  const { port, host, logger } = deps;
  const stopping = { value: false };
  const isStopping = () => stopping.value;
  const core = createCoreBootstrap({ ...deps, isStopping });
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

  let server: Bun.Server<unknown> | undefined;
  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      stopping.value = true;
      clearInterval(core.sessionSweepTimer);
      server?.stop(false);
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
      await server?.stop(true);
    })().catch(error => {
      stopPromise = null;
      throw error;
    });
    return stopPromise;
  };

  try {
    server = Bun.serve<unknown>({
      port,
      hostname: host,
      fetch(req, srv) {
        const ctx = {
          runtime: "bun" as const,
          ip: srv.requestIP(req)?.address ?? "",
          port: srv.port ?? port,
        };
        const decision = router.upgrade?.(req, ctx);
        if (decision && "response" in decision) return decision.response;
        if (decision) {
          const upgraded = srv.upgrade(req, { data: decision.data });
          return upgraded ? undefined : new Response("Upgrade Required", { status: 426 });
        }
        return router.fetch(req, ctx);
      },
      // Bun's peer carries `unknown` upgrade data while Core narrows it to WsData;
      // runtime shapes are structurally compatible, so cast only at this boundary.
      websocket: core.wsHandlers as Bun.WebSocketHandler<unknown>,
    });
  } catch (error) {
    await stop();
    throw error;
  }

  logger.info("core ready", { port: server.port, address: host });
  return {
    port: server.port!,
    tools: core.allTools.map(t => t.name),
    toolInfos: core.toolInfos,
    mcpServerInfos: core.getMcpServerInfos(),
    stop,
  };
}
