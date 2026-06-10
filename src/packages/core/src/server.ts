import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import type { Logger } from "@atom-neo/shared";
import type { PipelineResult, SessionMessage } from "@atom-neo/shared";
import { BusEvents, WsMessages } from "@atom-neo/shared";
import { initPromptRegistry } from "@atom-neo/shared";
import { TaskSource } from "@atom-neo/shared";
import { createTaskItem } from "./task-factory";
import { TaskQueue } from "./task-queue";
import { TaskEngine } from "./task-engine";
import { SessionStore } from "./session/store";
import { Broadcaster } from "./ws/broadcaster";
import { createWsHandlers } from "./ws/handler";
import { healthHandler, metricsHandler } from "./api/health";
import { createTaskHandler, taskCancelHandler, setPipeline } from "./api/tasks";
import { ToolRegistry } from "./tools/registry";
import { registerBuiltinTools, createAllTools } from "./tools/bootstrap";
import { registerConversationElements } from "./pipelines/conversation";
import { registerPredictionElements } from "./pipelines/prediction";
import { registerFollowUpElements } from "./pipelines/follow-up";
import { registerFollowUpEvaluatorElements, followUpEvaluatorPipeline } from "./pipelines/follow-up-evaluator";
import { registerContextCompressElements, contextCompressPipeline } from "./pipelines/context-compress";
import { registerPostConversationElements, postConversationPipeline } from "./pipelines/post-conversation";
import { conversationPipeline } from "./pipelines/conversation";
import { predictionPipeline } from "./pipelines/prediction";
import { InternalTaskOrchestrator } from "./task/internal-task-orchestrator";
import { DEFAULT_MAX_TOKENS, resolveContextLimit } from "./constants";

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
  runtime: RuntimeLike;
};

/** Start the core HTTP + WebSocket server with AI pipeline processing. */
export async function startCore(deps: CoreDeps): Promise<{ port: number; tools: string[]; stop: () => void }> {
  const { port, host, logger, sm, runtime } = deps;
  const sandbox: string = runtime.sandbox ?? "";
  const resolved = runtime?.getResolvedModel?.("balanced") ?? {
    provider: "deepseek", model: "deepseek-v4-flash", apiKey: runtime?.apiKey ?? "",
  };
  const apiKey: string = resolved.apiKey;
  const model: string = resolved.model;
  const baseUrl: string | undefined = resolved.baseUrl;
  const providerOptions: Record<string, Record<string, unknown>> = {
    deepseek: { thinking: { type: resolved.thinking ?? "disabled" } },
  };
  const providerModel = `${resolved.provider}/${model}`;
  const configContextLimit: number | undefined = runtime?.appConfig?.providers?.[resolved.provider]?.contextLimit;
  const resolvedContextLimit = resolveContextLimit(providerModel, configContextLimit);
  const maxTokens: number = runtime?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxSteps: number = runtime?.appConfig?.conversation?.maxSteps ?? 50;
  const maxChainDepth: number = runtime?.appConfig?.conversation?.maxChainDepth ?? 5;
  const memory = sm.get("memory");
  const getCompiledPrompt = () => {
    const compiler = sm.get<CompilerLike>("agents-compiler");
    return compiler?.getCompiledPrompt() ?? "";
  };

  const allTools = createAllTools(sandbox, memory, runtime?.appConfig?.permission?.whitelist ?? []);

  const pipelineBuilders: Record<string, (task: any) => any> = {
    prediction: (task: any) => {
      const session = sessionStore.get(task.sessionId);
      return predictionPipeline({
        session,
        task,
        apiKey, model, baseUrl, maxTokens,
        orchestrator,
      }).build(bus);
    },

    conversation: (task: any) => {
      const session = sessionStore.get(task.sessionId);
      const prediction = session.pendingPrediction ?? {
        difficulty: "medium",
        modelProfile: "balanced",
        intent: "conversation",
        contextRelevance: "standalone",
        reasoning: "default",
      };

      const DIFFICULTY_PROFILE: Record<string, string> = { mygod: "advanced", hard: "balanced" };
      const effectiveProfile = session.upgradeModel
        ? "advanced"
        : DIFFICULTY_PROFILE[prediction.difficulty] ?? prediction.modelProfile;

      const resolvedModel = runtime.getResolvedModel
        ? runtime.getResolvedModel(effectiveProfile)
        : { provider: "deepseek", model: "deepseek-v4-flash", apiKey, baseUrl, thinking: "disabled" as const };

      return conversationPipeline({
        session,
        task,
        apiKey: resolvedModel.apiKey,
        model: resolvedModel.model,
        baseUrl: resolvedModel.baseUrl,
        providerModel: `${resolvedModel.provider}/${resolvedModel.model}`,
        configContextLimit,
        providerOptions: {
          deepseek: { thinking: { type: resolvedModel.thinking ?? "disabled" } },
        },
        tools: allTools,
        getCompiledPrompt,
        maxTokens,
        maxSteps,
        memory,
        intent: prediction.intent,
        contextRelevance: prediction.contextRelevance,
        sandbox,
        orchestrator,
      }).build(bus);
    },

    "follow-up-evaluator": (task: any) => {
      const session = sessionStore.get(task.sessionId);
      return followUpEvaluatorPipeline({
        session,
        task,
        apiKey, model, baseUrl, maxTokens,
        orchestrator,
        configContextLimit: resolvedContextLimit,
      }).build(bus);
    },

    "context-compress": (task: any) => {
      const session = sessionStore.get(task.sessionId);
      return contextCompressPipeline({
        session,
        task,
        apiKey, model, baseUrl,
        orchestrator,
        sandbox,
      }).build(bus);
    },

    "post-conversation": (task: any) => {
      const session = sessionStore.get(task.sessionId);
      return postConversationPipeline({
        session,
        task,
        apiKey, model, baseUrl, maxTokens,
      }).build(bus);
    },
  };

  const sessionStore = new SessionStore(1000, (msg, ctx) => logger.debug(msg, ctx));
  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry, sandbox, runtime?.appConfig?.permission?.whitelist ?? []);
  logger.info("tools registered", { count: toolRegistry.getAll().length });

  initPromptRegistry();
  registerConversationElements();
  registerPredictionElements();
  registerFollowUpElements();
  registerFollowUpEvaluatorElements();
  registerContextCompressElements();
  registerPostConversationElements();

  const bus = new PipelineEventBus<FullEventMap>();
  bus.onHandlerError((eventName, error) => logger.error("event handler failed", { eventName, error: String(error) }));
  bus.on(BusEvents.Task.Completed, (p) => {
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
        pipeline: p.task.pipeline,
        visible: p.task.pipeline === "conversation",
        ...(reasoningContent ? { reasoningContent } : {}),
      };
      sessionStore.get(sid).addMessage(msg);
      logger.debug("task completed: message added to session", { sessionId: sid, msgCount: sessionStore.get(sid).messages.length, pipeline: p.task.pipeline });
      if (p.task.pipeline === "conversation") {
        sessionStore.get(sid).markSafeMessageCount();
      }
    }
    if (sid && result.tokenUsage) {
      sessionStore.get(sid).addTokenUsage(result.tokenUsage.total);
    }
    const accumulated = sessionStore.get(sid).tokenUsage;
    broadcaster.broadcastToSession(sid, {
      type: WsMessages.Server.TaskCompleted,
      ts: Date.now(), seq: 0,
      payload: { taskId: p.task.id, parentTaskId: p.task.parentTaskId, output: result.output ?? "", tokenUsage: accumulated },
    });
  });
  bus.on(BusEvents.Task.Failed, (p) => {
    logger.error("task failed", { taskId: p.task.id, error: String(p.error).slice(0, 200) });
  });

  bus.on(BusEvents.Pipeline.ElementStarted, (p) => {
    logger.debug("pipeline element started", { pipeline: p.pipelineName, element: p.elementName, kind: p.elementKind });
  });
  bus.on(BusEvents.Pipeline.ElementFinished, (p) => {
    logger.debug("pipeline element done", { pipeline: p.pipelineName, element: p.elementName, durationMs: p.durationMs });
  });
  bus.on(BusEvents.Pipeline.ElementFailed, (p) => {
    logger.warn("pipeline element failed", { pipeline: p.pipelineName, element: p.elementName, error: String(p.error).slice(0, 200) });
  });
  bus.on(BusEvents.Element.Data, (e) => {
    const { step, level, ...data } = e.payload;
    const msg = `${e.name}: ${step}`;
    if (level === "warn") logger.warn(msg, data);
    else if (level === "error") logger.error(msg, data);
    else logger.debug(msg, data);
  });

  const taskQueue = new TaskQueue();
  const orchestrator = new InternalTaskOrchestrator(taskQueue);

  bus.on(BusEvents.Conversation.Chain as any, (e: { name: string; payload: { sessionId: string; chatId: string; parentTaskId: string; action: string } }) => {
    const p = e.payload;
    const session = sessionStore.get(p.sessionId);
    logger.debug("conversation chain: handler entered", { action: p.action, sessionMsgCount: session.messages.length, chainDepth: session.chainDepth });

    if (p.action === "post_check_retry") {
      if (session.pendingPrediction) {
        session.pendingPrediction.contextRelevance = "continuation";
      }
      session.incrementChainDepth();
      orchestrator.scheduleFollowUp(p.sessionId, p.chatId, p.parentTaskId);
      return;
    }

    if (session.pendingPrediction) {
      session.pendingPrediction.contextRelevance = "continuation";
    }

    const hasActiveTodos = session.todoState?.some(
      (t: any) => t.status !== "completed" && t.status !== "cancelled",
    );

    if (hasActiveTodos) {
      logger.debug("conversation chain: active todos, skipping evaluator, scheduling follow-up", { chainDepth: session.chainDepth });
      session.incrementChainDepth();
      orchestrator.scheduleFollowUp(p.sessionId, p.chatId, p.parentTaskId);
      return;
    }

    if (session.todoState && session.todoState.length > 0) {
      logger.debug("conversation chain: all todos completed, ending chain", { todoCount: session.todoState.length });
      return;
    }

    const depth = session.chainDepth;
    if (depth >= maxChainDepth) {
      logger.debug("conversation chain: depth exceeded, scheduling evaluator", { depth, action: p.action });
      orchestrator.scheduleEvaluator(p.sessionId, p.chatId, p.parentTaskId);
      return;
    }
    if (depth >= 3 && depth % 3 === 0) {
      logger.debug("conversation chain: periodic evaluator", { depth, action: p.action });
      orchestrator.scheduleEvaluator(p.sessionId, p.chatId, p.parentTaskId);
      return;
    }
    session.incrementChainDepth();
    orchestrator.scheduleFollowUp(p.sessionId, p.chatId, p.parentTaskId);
  });

  bus.on(BusEvents.Conversation.Idle as any, (e: { name: string; payload: { sessionId: string; chatId: string; parentTaskId: string } }) => {
    const p = e.payload;
    logger.debug("conversation idle: scheduling post-conversation check", { sessionId: p.sessionId });
    orchestrator.schedulePostConversation(p.sessionId, p.chatId, p.parentTaskId);
  });

  const taskEngine = new TaskEngine({ bus, queue: taskQueue, pipelineBuilders });
  taskEngine.start();

  const broadcaster = new Broadcaster();
  const wsHandlers = createWsHandlers({ broadcaster, taskQueue, bus, logger });

  // Bridge: bus transport.delta → WebSocket broadcaster for real-time streaming
  // BaseElement.report() wraps payload in { name, payload } — FullEventMap doesn't reflect this yet
  bus.on(BusEvents.Transport.Delta as any, (ev: { name: string; payload: { textDelta: string } }) => {
    const textDelta = ev.payload.textDelta;
    if (textDelta) {
      broadcaster.broadcast({ type: WsMessages.Server.TransportDelta, ts: Date.now(), seq: 0, payload: { textDelta } });
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
          session.resetChainDepth();
        }
        return createTaskHandler(taskQueue, body, bus);
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
  return { port: server.port!, tools: allTools.map((t: any) => t.name), stop: () => { taskEngine.stop(); server.stop(); } };
}
