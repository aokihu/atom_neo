import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import type { Logger } from "@atom-neo/shared";
import type { PipelineResult, SessionMessage } from "@atom-neo/shared";
import { TaskQueue } from "./task-queue";
import { TaskEngine } from "./task-engine";
import { SessionStore } from "./session/store";
import { Broadcaster } from "./ws/broadcaster";
import { createWsHandlers } from "./ws/handler";
import { healthHandler, metricsHandler } from "./api/health";
import { createTaskHandler, taskCancelHandler, setPipeline } from "./api/tasks";
import { ToolRegistry } from "./tools/registry";
import { registerBuiltinTools, createAllTools, partitionTools } from "./tools/bootstrap";
import { registerConversationElements } from "./pipelines/conversation";
import { registerPredictionElements } from "./pipelines/prediction";
import { registerFollowUpElements } from "./pipelines/follow-up";
import { conversationPipeline } from "./pipelines/conversation";
import { DEFAULT_MAX_TOKENS } from "./constants";

const API_PREFIX = "/api/";
const LOG_OUTPUT_MAX_LEN = 200;

interface RuntimeLike {
  sandbox: string;
  apiKey: string;
  appConfig: Record<string, any>;
  maxTokens: number;
  getResolvedModel(level?: string): {
    provider: string; model: string; apiKey: string; baseUrl?: string; thinking?: string;
  };
}

interface CompilerLike {
  getCompiledPrompt(): string;
}

interface TaskRequestBody {
  sessionId?: string;
  chatId?: string;
  data?: { text?: string };
}

type CompletedResult = PipelineResult & {
  output?: string;
  responseText?: string;
  reasoningContent?: string;
  tokenUsage?: { total: number };
};

interface ServiceProvider {
  get<T>(name: string): T | undefined;
}

export type CoreDeps = {
  port: number;
  host: string;
  logger: Logger;
  sm: ServiceProvider;
};

export async function startCore(deps: CoreDeps): Promise<{ port: number; tools: string[]; stop: () => void }> {
  const { port, host, logger, sm } = deps;
  const runtime = sm.get<RuntimeLike>("runtime")!;
  const sandbox: string = runtime?.sandbox ?? "";
  const resolved = runtime?.getResolvedModel?.("balanced") ?? {
    provider: "deepseek", model: "deepseek-chat", apiKey: runtime?.apiKey ?? "",
  };
  const apiKey: string = resolved.apiKey;
  const model: string = resolved.model;
  const baseUrl: string | undefined = resolved.baseUrl;
  const providerOptions: Record<string, Record<string, unknown>> = {
    deepseek: { thinking: { type: resolved.thinking ?? "disabled" } },
  };
  const providerModel = `${resolved.provider}/${model}`;
  const configContextLimit: number | undefined = runtime?.appConfig?.providers?.[resolved.provider]?.contextLimit;
  const maxTokens: number = runtime?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const memory = sm.get("memory");
  const getCompiledPrompt = () => {
    const compiler = sm.get<CompilerLike>("agents-compiler");
    return compiler?.getCompiledPrompt() ?? "";
  };

  const buildChainPipeline = (chainTaskId: string, sessionId: string, chatId: string, chainDepth: number) => {
    const pipeline = conversationPipeline({
      session: sessionStore.get(sessionId),
      task: { id: chainTaskId, sessionId, chatId, sandbox, payload: [] },
      apiKey, model, baseUrl, providerModel, configContextLimit, providerOptions,
      tools: [...basic, ...advanced],
      getCompiledPrompt, maxTokens, memory,
      chainDepth,
    }).build(bus);
    setPipeline(chainTaskId, pipeline);
  };

  const allTools = createAllTools(sandbox, memory, runtime?.appConfig?.permission?.whitelist ?? []);
  const { basic, advanced } = partitionTools(allTools);

  const sessionStore = new SessionStore();
  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry, sandbox, runtime?.appConfig?.permission?.whitelist ?? []);
  logger.info("tools registered", { count: toolRegistry.getAll().length });

  registerConversationElements();
  registerPredictionElements();
  registerFollowUpElements();

  const bus = new PipelineEventBus<FullEventMap>();
  bus.on("task.completed", (p) => {
    const result = p.result as CompletedResult;
    logger.info("task completed", {
      taskId: p.task.id,
      output: result.output?.slice(0, LOG_OUTPUT_MAX_LEN),
    });
    const sid = p.task.sessionId;
    const output = result.responseText || result.output || "";
    const reasoningContent = result.reasoningContent || "";
    if (sid && output) {
      const msg = {
        role: "assistant" as const,
        content: output,
        timestamp: Date.now(),
        ...(reasoningContent ? { reasoningContent } : {}),
      };
      sessionStore.get(sid).addMessage(msg);
    }
    if (sid && result.tokenUsage) {
      sessionStore.get(sid).addTokenUsage(result.tokenUsage.total);
    }
    const accumulated = sessionStore.get(sid).tokenUsage;
    broadcaster.broadcastToSession(sid, {
      type: "event.task.completed",
      ts: Date.now(), seq: 0,
      payload: { taskId: p.task.id, output: result.output ?? "", tokenUsage: accumulated },
    });
  });
  bus.on("task.failed", (p) => {
    logger.error("task failed", { taskId: p.task.id, error: String(p.error).slice(0, 200) });
  });

  const taskQueue = new TaskQueue();
  const taskEngine = new TaskEngine({ bus, queue: taskQueue });
  taskEngine.start();

  const broadcaster = new Broadcaster();
  const wsHandlers = createWsHandlers({ broadcaster, taskQueue, bus });

  // Bridge: bus transport.delta → WebSocket broadcaster for real-time streaming
  // BaseElement.report() wraps payload in { name, payload } — FullEventMap doesn't reflect this yet
  bus.on("transport.delta" as any, (ev: { name: string; payload: { textDelta: string } }) => {
    const textDelta = ev.payload.textDelta;
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

      if (url.pathname === `${API_PREFIX}health`) return healthHandler(taskQueue);
      if (url.pathname === `${API_PREFIX}metrics`) return metricsHandler(taskQueue);

      if (url.pathname === `${API_PREFIX}tasks` && method === "POST") {
        const body = await req.json().catch(() => ({})) as TaskRequestBody;
        const session = sessionStore.get(body.sessionId ?? "default");
        if (body.data?.text) {
          session.addMessage({ role: "user", content: body.data.text, timestamp: Date.now() });
        }
        const pipeline = conversationPipeline({
          session,
          task: { id: "pending", sessionId: body.sessionId, chatId: body.chatId, sandbox, payload: [{ type: "text", data: body.data?.text ?? "" }] },
          apiKey, model, baseUrl, providerModel, configContextLimit, providerOptions,
          tools: basic,
          getCompiledPrompt, maxTokens, memory,
          queue: taskQueue, buildChainPipeline, chainDepth: 0,
        }).build(bus);
        return createTaskHandler(taskQueue, body, bus, pipeline);
      }
      if (url.pathname.startsWith(`${API_PREFIX}sessions/`) && method === "GET") {
        const sid = url.pathname.split("/").pop()!;
        return Response.json(sessionStore.has(sid) ? sessionStore.get(sid).messages : []);
      }
      if (url.pathname.startsWith(`${API_PREFIX}tasks/`) && method === "DELETE") {
        return taskCancelHandler(taskQueue, req, url.pathname.split("/").pop()!);
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: wsHandlers,
  });

  logger.info("core ready", { port: server.port, address: host });
  return { port: server.port!, tools: basic.map(t => t.name), stop: () => { taskEngine.stop(); server.stop(); } };
}
