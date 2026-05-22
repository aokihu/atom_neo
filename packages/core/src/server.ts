import type { FullEventMap, PipelineEventBus } from "@atom-neo/shared";
import { Logger, StdoutSink, LogHub } from "@atom-neo/shared";
import { loadCoreConfig } from "./config";
import { TaskQueue } from "./task-queue";
import { TaskEngine } from "./task-engine";
import { SessionStore } from "./session/store";
import { Broadcaster } from "./ws/broadcaster";
import { createWsHandlers } from "./ws/handler";
import { healthHandler, metricsHandler } from "./api/health";
import { createTaskHandler, taskCancelHandler } from "./api/tasks";
import { PipelineRecorder } from "./replay/recorder";
import { PipelinePlayer } from "./replay/player";
import { ToolRegistry } from "./tools/registry";
import { registerBuiltinTools } from "./tools/bootstrap";
import { registerConversationElements } from "./pipelines/conversation";
import { registerPredictionElements } from "./pipelines/prediction";
import { registerFollowUpElements } from "./pipelines/follow-up";
import { PipelineManager } from "./pipeline/manager";
import { conversationPipeline } from "./pipelines/conversation";

export async function startCore(bus?: PipelineEventBus<FullEventMap>): Promise<void> {
  const config = loadCoreConfig();

  // Log
  const hub = new LogHub();
  hub.addSink(new StdoutSink());
  const logger = new Logger(
    ["debug", "info", "warn", "error"][config.logLevel - 1] as any,
    (entry) => hub.write(entry),
  );
  logger.info("config loaded", { port: config.port });

  // Session
  const sessionStore = new SessionStore(config.maxSessions);

  // Tools
  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry);
  logger.info("tools registered", { count: toolRegistry.getAll().length });

  // Pipeline
  registerConversationElements();
  registerPredictionElements();
  registerFollowUpElements();

  const pipelineManager = new PipelineManager();
  pipelineManager.register("conversation", () =>
    conversationPipeline({ session: null, task: null }).build(undefined as any),
  );
  logger.info("pipelines registered", { count: pipelineManager.list().length });

  // Task
  const taskQueue = new TaskQueue();
  const taskEngine = new TaskEngine({
    bus: bus ?? ({} as PipelineEventBus<FullEventMap>),
    queue: taskQueue,
    timeoutMs: config.taskTimeoutMs,
  });
  taskEngine.start();

  // Replay
  const recorder = new PipelineRecorder({
    enabled: config.replayEnabled,
    maxEvents: config.replayMaxEvents,
  });

  // WS
  const broadcaster = new Broadcaster();
  const wsHandlers = createWsHandlers({
    broadcaster,
    taskQueue,
    bus: bus ?? ({} as PipelineEventBus<FullEventMap>),
  });

  // Server
  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;

      // Health
      if (url.pathname === "/api/health") return healthHandler(taskQueue);
      if (url.pathname === "/api/metrics") return metricsHandler(taskQueue);

      // Tasks
      if (url.pathname === "/api/tasks" && method === "POST") {
        return createTaskHandler(taskQueue, req as any);
      }
      if (url.pathname.startsWith("/api/tasks/") && method === "DELETE") {
        const id = url.pathname.split("/").pop()!;
        return taskCancelHandler(taskQueue, req, id);
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: wsHandlers,
  });

  logger.info("core ready", { port: server.port, hostname: config.host });

  process.on("SIGTERM", () => {
    logger.info("shutting down");
    taskEngine.stop();
    server.stop();
    process.exit(0);
  });
}

// Direct run
if (import.meta.main) {
  startCore();
}
