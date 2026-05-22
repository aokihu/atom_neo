import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import type { Logger } from "@atom-neo/shared";
import { TaskQueue } from "./task-queue";
import { TaskEngine } from "./task-engine";
import { SessionStore } from "./session/store";
import { Broadcaster } from "./ws/broadcaster";
import { createWsHandlers } from "./ws/handler";
import { healthHandler, metricsHandler } from "./api/health";
import { createTaskHandler, taskCancelHandler } from "./api/tasks";
import { ToolRegistry } from "./tools/registry";
import { registerBuiltinTools } from "./tools/bootstrap";
import { registerConversationElements } from "./pipelines/conversation";
import { registerPredictionElements } from "./pipelines/prediction";
import { registerFollowUpElements } from "./pipelines/follow-up";
import { conversationPipeline } from "./pipelines/conversation";

export type CoreDeps = {
  port: number;
  host: string;
  sandbox: string;
  logger: Logger;
  apiKey: string;
};

export async function startCore(deps: CoreDeps): Promise<void> {
  const { port, host, sandbox, logger, apiKey } = deps;

  const sessionStore = new SessionStore();

  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry);
  logger.info("tools registered", { count: toolRegistry.getAll().length });

  registerConversationElements();
  registerPredictionElements();
  registerFollowUpElements();

  const bus = new PipelineEventBus<FullEventMap>();
  bus.on("task.completed" as any, (p: any) => {
    logger.info("task completed", {
      taskId: p.task?.id,
      output: (p.result as any)?.output?.slice(0, 200),
    });
  });
  bus.on("task.failed" as any, (p: any) => {
    logger.error("task failed", {
      taskId: p.task?.id,
      error: String(p.error).slice(0, 200),
    });
  });

  const taskQueue = new TaskQueue();
  const taskEngine = new TaskEngine({ bus, queue: taskQueue });
  taskEngine.start();

  const broadcaster = new Broadcaster();
  const wsHandlers = createWsHandlers({ broadcaster, taskQueue, bus });

  const server = Bun.serve({
    port: port || 3100,
    hostname: host,
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
          apiKey,
          model: "deepseek-chat",
          tools: toolRegistry.getAll(),
        }).build(bus);

        return createTaskHandler(taskQueue, body, bus, pipeline);
      }
      if (url.pathname.startsWith("/api/tasks/") && method === "DELETE") {
        return taskCancelHandler(taskQueue, req, url.pathname.split("/").pop()!);
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: wsHandlers,
  });

  logger.info("core ready", { port: server.port, address: host });
}
