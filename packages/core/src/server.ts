import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
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
import { ToolRegistry } from "./tools/registry";
import { registerBuiltinTools } from "./tools/bootstrap";
import { setSandbox } from "./tools/builtin/fs";
import { setBashSandbox } from "./tools/builtin/bash";
import { registerConversationElements } from "./pipelines/conversation";
import { registerPredictionElements } from "./pipelines/prediction";
import { registerFollowUpElements } from "./pipelines/follow-up";
import { PipelineManager } from "./pipeline/manager";
import { conversationPipeline } from "./pipelines/conversation";

export async function startCore(): Promise<void> {
  const config = loadCoreConfig();

  const hub = new LogHub();
  hub.addSink(new StdoutSink());
  const logger = new Logger(
    (["debug", "info", "warn", "error"] as const)[config.logLevel - 1] ?? "info",
    (entry) => hub.write(entry),
  );
  logger.info("config loaded", { port: config.port });

  const sessionStore = new SessionStore(config.maxSessions);

  setSandbox(config.sandboxPath);
  setBashSandbox(config.sandboxPath);
  logger.info("sandbox ready", { path: config.sandboxPath });

  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry);
  logger.info("tools registered", { count: toolRegistry.getAll().length });

  registerConversationElements();
  registerPredictionElements();
  registerFollowUpElements();

  const bus = new PipelineEventBus<FullEventMap>();

  // Wire bus events to logging
  bus.on("task.completed" as any, (payload: any) => {
    logger.info("task completed", {
      taskId: payload.task?.id,
      output: (payload.result as any)?.output?.slice(0, 200),
    });
  });
  bus.on("task.failed" as any, (payload: any) => {
    logger.error("task failed", {
      taskId: payload.task?.id,
      error: String(payload.error).slice(0, 200),
    });
  });

  const pipelineManager = new PipelineManager();
  pipelineManager.register("conversation", () =>
    conversationPipeline({
      session: { messages: [] },
      task: { id: "init", sessionId: "init", chatId: "init", payload: [] },
      apiKey: config.deepseekApiKey,
      model: config.transportModel.split("/").pop() ?? "deepseek-chat",
      tools: toolRegistry.getAll(),
    }).build(bus),
  );
  logger.info("pipelines registered", { count: pipelineManager.list().length });

  const taskQueue = new TaskQueue();
  const taskEngine = new TaskEngine({
    bus,
    queue: taskQueue,
    timeoutMs: config.taskTimeoutMs,
  });
  taskEngine.start();

  const recorder = new PipelineRecorder({
    enabled: config.replayEnabled,
    maxEvents: config.replayMaxEvents,
  });

  // WS
  const broadcaster = new Broadcaster();
  const wsHandlers = createWsHandlers({ broadcaster, taskQueue, bus });

  // Server
  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;

      if (url.pathname === "/api/health") return healthHandler(taskQueue);
      if (url.pathname === "/api/metrics") return metricsHandler(taskQueue);

      if (url.pathname === "/api/tasks" && method === "POST") {
        const body: any = await req.json().catch(() => ({}));
        const session = sessionStore.get(body.sessionId ?? "default");
        if (body.data?.text) {
          session.addMessage({ role: "user", content: body.data.text, timestamp: Date.now() });
        }

        const pipeline = conversationPipeline({
          session,
          task: { id: "pending", sessionId: body.sessionId, chatId: body.chatId, payload: [{ type: "text", data: body.data?.text ?? "" }] },
          apiKey: config.deepseekApiKey,
          model: config.transportModel.split("/").pop() ?? "deepseek-chat",
          tools: toolRegistry.getAll(),
        }).build(bus);

        return createTaskHandler(taskQueue, body, bus, pipeline);
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

if (import.meta.main) {
  startCore();
}
