import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import type { Logger } from "@atom-neo/shared";
import { TaskQueue } from "./task-queue";
import { TaskEngine } from "./task-engine";
import { SessionStore } from "./session/store";
import { Broadcaster } from "./ws/broadcaster";
import { createWsHandlers } from "./ws/handler";
import { healthHandler, metricsHandler } from "./api/health";
import { createTaskHandler, taskCancelHandler, setPipeline } from "./api/tasks";
import { createTaskItem } from "./task-factory";
import { TaskSource } from "@atom-neo/shared";
import { ToolRegistry } from "./tools/registry";
import { registerBuiltinTools, createAllTools, partitionTools } from "./tools/bootstrap";
import type { ToolDefinition } from "@atom-neo/shared";
import { registerConversationElements } from "./pipelines/conversation";
import { registerPredictionElements } from "./pipelines/prediction";
import { registerFollowUpElements } from "./pipelines/follow-up";
import { conversationPipeline } from "./pipelines/conversation";

interface ServiceProvider {
  get<T>(name: string): T | undefined;
}

export type CoreDeps = {
  port: number;
  host: string;
  logger: Logger;
  sm: ServiceProvider;
};

export async function startCore(deps: CoreDeps): Promise<{ stop: () => void }> {
  const { port, host, logger, sm } = deps;
  const runtime: any = sm.get("runtime");
  const sandbox: string = runtime?.sandbox ?? "";
  const resolved = runtime?.getResolvedModel?.("balanced") ?? {
    provider: "deepseek", model: "deepseek-chat", apiKey: runtime?.apiKey ?? "",
  };
  const apiKey: string = resolved.apiKey;
  const model: string = resolved.model;
  const baseUrl: string | undefined = resolved.baseUrl;
  const maxTokens: number = runtime?.maxTokens ?? 4096;
  const memory: any = sm.get("memory");
  const getCompiledPrompt = () => {
    const compiler: any = sm.get("agents-compiler");
    return compiler?.getCompiledPrompt?.() ?? "";
  };

  const allTools = createAllTools(sandbox, memory);
  const { basic, advanced } = partitionTools(allTools);

  const sessionStore = new SessionStore();
  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry, sandbox);
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
    const sid = (p.task as any)?.sessionId;
    const output = (p.result as any)?.responseText || (p.result as any)?.output || "";
    if (sid && output) {
      sessionStore.get(sid).addMessage({ role: "assistant", content: output, timestamp: Date.now() });
    }

    // Broadcast task completion to WebSocket clients
    broadcaster.broadcastToSession(sid ?? "", {
      type: "event.task.completed",
      ts: Date.now(), seq: 0,
      payload: { taskId: p.task?.id, output: (p.result as any)?.output ?? "" },
    });

    if ((p.result as any)?.needMoreTools) {
      const task = createTaskItem({
        sessionId: sid ?? "default",
        chatId: (p.task as any)?.chatId ?? "default",
        pipeline: "conversation",
        source: TaskSource.INTERNAL,
        payload: [{ type: "text", data: "" }],
        parentTaskId: p.task?.id,
        chainId: (p.task as any)?.chainId,
      });

      const pipeline = conversationPipeline({
        session: sessionStore.get(sid ?? "default"),
        task: { id: task.id, sessionId: sid, chatId: (p.task as any)?.chatId, sandbox, payload: [] },
        apiKey, model, baseUrl,
        tools: [...basic, ...advanced],
        getCompiledPrompt, maxTokens, memory,
      }).build(bus);

      setPipeline(task.id, pipeline);
      taskQueue.enqueue(task);
      bus.emit("task.enqueued" as any, { task });
    }
  });
  bus.on("task.failed" as any, (p: any) => {
    logger.error("task failed", { taskId: p.task?.id, error: String(p.error).slice(0, 200) });
  });

  const taskQueue = new TaskQueue();
  const taskEngine = new TaskEngine({ bus, queue: taskQueue });
  taskEngine.start();

  const broadcaster = new Broadcaster();
  const wsHandlers = createWsHandlers({ broadcaster, taskQueue, bus });

  // Bridge: bus transport.delta → WebSocket broadcaster for real-time streaming
  bus.on("transport.delta" as any, (payload: any) => {
    // payload from BaseElement.report(): { name: string, payload: { textDelta } }
    const textDelta = payload?.payload?.textDelta ?? "";
    if (textDelta) {
      broadcaster.broadcast({ type: "event.transport.delta", ts: Date.now(), seq: 0, payload: { textDelta } });
    }
  });

  const server = Bun.serve({
    port: port || 3100,
    hostname: host,
    async fetch(req, srv) {
      const url = new URL(req.url);

      // WebSocket upgrade for /ws/:sessionId
      if (url.pathname.startsWith("/ws/")) {
        const sid = url.pathname.split("/ws/").pop() || "default";
        srv.upgrade(req, { data: { sessionId: sid } });
        return; // handled by websocket handlers
      }

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
          task: { id: "pending", sessionId: body.sessionId, chatId: body.chatId, sandbox, payload: [{ type: "text", data: body.data?.text ?? "" }] },
          apiKey, model, baseUrl,
          tools: basic,
        getCompiledPrompt, maxTokens, memory,
        }).build(bus);
        return createTaskHandler(taskQueue, body, bus, pipeline);
      }
      if (url.pathname.startsWith("/api/sessions/") && method === "GET") {
        const sid = url.pathname.split("/").pop()!;
        return Response.json(sessionStore.has(sid) ? sessionStore.get(sid).messages : []);
      }
      if (url.pathname.startsWith("/api/tasks/") && method === "DELETE") {
        return taskCancelHandler(taskQueue, req, url.pathname.split("/").pop()!);
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: wsHandlers,
  });

  logger.info("core ready", { port: server.port, address: host });
  return { stop: () => { taskEngine.stop(); server.stop(); } };
}
