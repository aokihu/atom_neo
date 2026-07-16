import { PipelineEventBus } from "@atom-neo/shared";
import type { ConversationChainAction, ConversationContinuationAction, FullEventMap } from "@atom-neo/shared";
import type { Logger } from "@atom-neo/shared";
import type { PipelineResult, SessionMessage } from "@atom-neo/shared";
import { BusEvents, WsMessages, sanitizeForJSON, substringWellFormed } from "@atom-neo/shared";
import { initPromptRegistry } from "@atom-neo/shared";
import { TaskSource, TaskState } from "@atom-neo/shared";
import { createTaskItem } from "./task-factory";
import { TaskQueue } from "./task-queue";
import { TaskEngine } from "./task-engine";
import { SessionStore } from "./session/store";
import { Broadcaster } from "./ws/broadcaster";
import { createWsHandlers } from "./ws/handler";
import { registerTransportBridge } from "./ws/transport-bridge";
import { healthHandler, metricsHandler } from "./api/health";
import { createTaskHandler, taskCancelHandler, taskStatusHandler } from "./api/tasks";
import { ToolRegistry } from "./tools/registry";
import { registerBuiltinTools, createAllTools } from "./tools/bootstrap";
import { initMCPClients, fetchMCPTools, closeMCPClients, startMCPHealthCheck } from "./tools/mcp-manager";
import type { MCPServerConfig } from "./tools/mcp-manager";
import { ScheduleService } from "./tools/schedule-service";
import { HookManager } from "./hooks/hook-manager";
import { createScheduleTools } from "./tools/builtin/schedule";
import { createSkillTools } from "./tools/builtin/skill";
import type { SkillServiceLike } from "./skills/types";
import { registerConversationElements } from "./pipelines/conversation";
import { registerPredictionElements } from "./pipelines/prediction";
import { registerFollowUpElements } from "./pipelines/follow-up";
import { registerFollowUpEvaluatorElements, followUpEvaluatorPipeline } from "./pipelines/follow-up-evaluator";
import { registerContextCompressElements, contextCompressPipeline } from "./pipelines/context-compress";
import { registerPostConversationElements, postConversationPipeline } from "./pipelines/post-conversation";
import { registerSharedElements } from "./pipelines/shared";
import { conversationPipeline } from "./pipelines/conversation";
import { predictionPipeline } from "./pipelines/prediction";
import { InternalTaskOrchestrator } from "./task/internal-task-orchestrator";
import { DEFAULT_MAX_TOKENS, resolveContextLimit } from "./constants";
import { ContextService } from "./context/context-service";
import { decideTodoContinuation } from "./session/context";
import { SessionPersistenceService } from "./session/persistence-service";

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
  chainAction?: ConversationContinuationAction;
  shouldPostCheck?: boolean;
  finishReason?: string;
  completeDetected?: boolean;
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
export async function startCore(deps: CoreDeps): Promise<{ port: number; tools: string[]; toolInfos: { name: string; source: string; description: string; online?: boolean }[]; mcpServerInfos: { name: string; online: boolean; toolCount: number }[]; stop: () => Promise<void> }> {
  const { port, host, logger, sm, runtime } = deps;
  const sandbox: string = runtime.sandbox ?? "";
  const resolved = runtime?.getResolvedModel?.("balanced") ?? {
    provider: "deepseek", model: "deepseek-v4-flash", apiKey: runtime?.apiKey ?? "",
  };
  const compressResolved = runtime?.getResolvedModel?.("basic") ?? resolved;
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
  const skillService = sm.get<SkillServiceLike>("skill");
  const getCompiledPrompt = () => {
    const compiler = sm.get<CompilerLike>("agents-compiler");
    return compiler?.getCompiledPrompt() ?? "";
  };

  const bus = new PipelineEventBus<FullEventMap>();
  bus.onHandlerError((eventName, error) => logger.error("event handler failed", { eventName, error: String(error) }));
  const contextService = new ContextService(bus);
  contextService.start();
  const persistence = new SessionPersistenceService(sandbox, contextService);
  const sessionStore = new SessionStore(1000, (msg, ctx) => logger.debug(msg, ctx), undefined, persistence);

  const allTools = createAllTools(sandbox, memory, runtime?.appConfig?.permission?.whitelist ?? [], persistence);
  if (skillService) {
    allTools.push(...createSkillTools(skillService));
  }

  const mcpToolsRef: { current: Record<string, any> } = { current: {} };
  let mcpServerInfos: { name: string; online: boolean; toolCount: number }[] = [];
  let mcpClients: Array<Awaited<ReturnType<typeof initMCPClients>>["clients"][number]> = [];

  const hookManagerRef: { current: HookManager | null } = { current: null };

  const toolInfos = allTools.map(t => ({ name: t.name, source: t.source as string, description: t.description, online: undefined as boolean | undefined }));

  const mcpConfigs: MCPServerConfig[] = runtime?.appConfig?.mcpServers ?? [];
  if (mcpConfigs.length > 0) {
    initMCPClients(mcpConfigs, logger).then(async ({ clients, matchedConfigs }) => {
      mcpClients = clients;
      if (clients.length === 0) return;
      const { tools, toolServers } = await fetchMCPTools(clients, matchedConfigs, logger);
      mcpToolsRef.current = tools;
      const names = Object.keys(tools);
      logger.info("mcp tools loaded", { mcpToolCount: names.length, totalTools: allTools.length + names.length });

      mcpServerInfos = matchedConfigs.map(cfg => ({
        name: cfg.name,
        online: true,
        toolCount: names.filter(n => toolServers[n] === cfg.name).length,
      }));

      broadcaster.broadcast(WsMessages.Server.MCPConnected, {
        servers: mcpServerInfos,
        toolInfos: names.map(name => ({ name, source: "mcp" as const, description: (tools[name] as any)?.description ?? "", online: true })),
      });

      const healthStop = startMCPHealthCheck(clients, matchedConfigs, toolServers, (statuses) => {
        broadcaster.broadcast(WsMessages.Server.MCPToolStatus, { servers: statuses });
        for (const s of statuses) {
          const info = mcpServerInfos.find(i => i.name === s.name);
          if (info) info.online = s.online;
        }
      }, logger);
      mcpHealthStopRef.current = healthStop;
    }).catch(err => logger.warn("mcp async init failed", { error: String(err) }));
  }

  const mcpHealthStopRef = { current: () => {} };

  const pipelineBuilders: Record<string, (task: any) => any> = {
    prediction: (task: any) => {
      const session = sessionStore.get(task.sessionId);
      return predictionPipeline({
        session,
        task,
        apiKey, model, baseUrl, maxTokens,
        orchestrator,
        configContextLimit: resolvedContextLimit,
        skillService,
      }).build(bus);
    },

    conversation: (task: any) => {
      const session = sessionStore.get(task.sessionId);
      const prediction = session.pendingPrediction ?? {
        difficulty: "medium",
        modelProfile: "balanced",
        intent: "conversation",
        contextRelevance: "standalone",
        memoryQuery: "",
        reasoning: "default",
      };

      const DIFFICULTY_PROFILE: Record<string, string> = { mygod: "advanced", hard: "balanced" };
      const topicId = session.currentTopic || undefined;
      const upgradeModel = contextService.get(
        topicId ? "topic" : "session",
        { sessionId: session.sessionId, ...(topicId ? { topicId } : {}) },
        "model-upgrade",
      );
      const effectiveProfile = upgradeModel
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
        configContextLimit: resolvedContextLimit,
        providerOptions: {
          deepseek: { thinking: { type: resolvedModel.thinking ?? "disabled" } },
        },
        tools: allTools,
        mcpToolsRef,
        getCompiledPrompt,
        maxTokens,
        maxSteps,
        memory,
        intent: prediction.intent,
        contextRelevance: prediction.contextRelevance,
        sandbox,
        orchestrator,
        skillService,
        contextService,
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
        contextService,
      }).build(bus);
    },

    "context-compress": (task: any) => {
      const session = sessionStore.get(task.sessionId);
      return contextCompressPipeline({
        session,
        task,
        apiKey: compressResolved.apiKey,
        model: compressResolved.model,
        baseUrl: compressResolved.baseUrl,
        orchestrator,
        sandbox,
        configContextLimit: resolvedContextLimit,
        maxTokens,
        contextService,
        persistence,
      }).build(bus);
    },

    "post-conversation": (task: any) => {
      const session = sessionStore.get(task.sessionId);
      return postConversationPipeline({
        session,
        task,
        apiKey, model, baseUrl, maxTokens,
        configContextLimit: resolvedContextLimit,
        contextService,
      }).build(bus);
    },
  };

  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry, sandbox, runtime?.appConfig?.permission?.whitelist ?? [], persistence);
  logger.info("tools registered", { count: toolRegistry.getAll().length });

  initPromptRegistry();
  registerConversationElements();
  registerPredictionElements();
  registerFollowUpElements();
  registerFollowUpEvaluatorElements();
  registerContextCompressElements();
  registerPostConversationElements();
  registerSharedElements();

  bus.on(BusEvents.Task.Enqueued, ({ task }) => {
    if (task.sessionId) sessionStore.acquireTask(task.id, task.sessionId);
  });
  bus.on(BusEvents.Task.Activated, (p) => {
    orchestrator.beginTask(p.task);
    const sid = p.task.sessionId;
    if (sid) {
      sessionStore.acquireTask(p.task.id, sid);
      sessionRef.current = { sessionId: sid, chatId: p.task.chatId ?? "default" };
      broadcaster.broadcastToSession(sid, WsMessages.Server.SessionTaskActive, {
        active: true,
        taskId: p.task.id,
      });
    }
  });
  bus.on(BusEvents.Task.Completed, (p) => {
    const result = p.result as CompletedResult;

    logger.info("task pipeline completed", {
      taskId: p.task.id,
      output: result.output ? substringWellFormed(result.output, 0, LOG_OUTPUT_MAX_LEN) : undefined,
    });
    const sid = p.task.sessionId;
    const output = sanitizeForJSON(result.responseText || result.output || "");
    const reasoningContent = result.reasoningContent || "";
    if (sid && output) {
      const msg = {
        role: "assistant" as const,
        content: output,
        timestamp: Date.now(),
        pipeline: p.task.pipeline,
        visible: p.task.pipeline === "conversation",
        metadata: {
          finishReason: result.finishReason ?? "",
          completeDetected: result.completeDetected ?? false,
        },
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
    const checkpointed = !sid || sessionStore.save(sid, "task_completed");
    if (!checkpointed) {
      const error = "Session checkpoint failed after task completion";
      p.task.state = TaskState.FAILED;
      taskQueue.storeResult(p.task.id, { taskId: p.task.id, state: TaskState.FAILED, error });
      logger.warn("session checkpoint failed after task completion", { sessionId: sid, taskId: p.task.id });
      orchestrator.discardTask(p.task.id);
      broadcaster.broadcastToSession(sid, WsMessages.Server.TaskFailed, {
        taskId: p.task.id,
        rootTaskId: p.task.chainId,
        error,
      });
      broadcaster.broadcastToSession(sid, WsMessages.Server.SessionTaskActive, {
        active: false,
        taskId: p.task.id,
      });
      return;
    }
    taskQueue.storeResult(p.task.id, { taskId: p.task.id, state: TaskState.COMPLETED, result });
    bus.emit(BusEvents.Task.Committed, { task: p.task, result: p.result });
    if (sid && p.task.pipeline === "conversation") {
      const payload = {
        sessionId: sid,
        chatId: p.task.chatId,
        parentTaskId: p.task.parentTaskId ?? p.task.id,
        ownerTaskId: p.task.id,
      };
      if (result.chainAction) {
        logger.debug("conversation completed: scheduling chain after persistence", { action: result.chainAction, sessionId: sid });
        bus.emit(BusEvents.Conversation.Chain as any, {
          name: "task-completed",
          payload: { ...payload, action: result.chainAction },
        } as any);
      } else if (result.shouldPostCheck) {
        logger.debug("conversation completed: scheduling post-conversation after persistence", { sessionId: sid });
        bus.emit(BusEvents.Conversation.Idle as any, {
          name: "task-completed",
          payload,
        } as any);
      }
    }
    orchestrator.commitTask(p.task.id);
    if (sid) {
      const accumulated = sessionStore.get(sid).tokenUsage;
      broadcaster.broadcastToSession(sid, WsMessages.Server.TaskCompleted, {
        taskId: p.task.id,
        parentTaskId: p.task.parentTaskId,
        output: result.output ?? "",
        reasoningContent,
        tokenUsage: accumulated,
      });
      broadcaster.broadcastToSession(sid, WsMessages.Server.SessionTaskActive, {
        active: false,
        taskId: p.task.id,
      });
    }
  });
  bus.on(BusEvents.Task.Failed, (p) => {
    orchestrator.discardTask(p.task.id);
    const cancelled = p.task.state === TaskState.CANCELLED;
    taskQueue.storeResult(p.task.id, { taskId: p.task.id, state: p.task.state, error: String(p.error) });
    const logContext = { taskId: p.task.id, error: substringWellFormed(String(p.error), 0, 200) };
    if (cancelled) logger.info("task cancelled", logContext);
    else logger.error("task failed", logContext);
    const sid = p.task.sessionId;
    if (sid && !sessionStore.save(sid, "task_failed")) {
      logger.warn("session checkpoint failed after task failure", { sessionId: sid, taskId: p.task.id });
    }
    if (sid) {
      broadcaster.broadcastToSession(sid, WsMessages.Server.TaskFailed, {
        taskId: p.task.id,
        rootTaskId: p.task.chainId,
        ...(cancelled ? { code: "PIPELINE_ABORTED" } : {}),
        error: String(p.error),
      });
      broadcaster.broadcastToSession(sid, WsMessages.Server.SessionTaskActive, {
        active: false,
        taskId: p.task.id,
      });
    }
  });
  bus.on(BusEvents.Task.Completed, ({ task }) => {
    sessionStore.releaseTask(task.id);
  });
  bus.on(BusEvents.Task.Failed, ({ task }) => {
    sessionStore.releaseTask(task.id);
  });

  bus.on(BusEvents.Pipeline.ElementStarted, (p) => {
    logger.debug("pipeline element started", { pipeline: p.pipelineName, element: p.elementName, kind: p.elementKind });
  });
  bus.on(BusEvents.Pipeline.ElementFinished, (p) => {
    logger.debug("pipeline element done", { pipeline: p.pipelineName, element: p.elementName, durationMs: p.durationMs });
  });
  bus.on(BusEvents.Pipeline.ElementFailed, (p) => {
    logger.warn("pipeline element failed", { pipeline: p.pipelineName, element: p.elementName, error: substringWellFormed(String(p.error), 0, 200) });
  });
  bus.on(BusEvents.Element.Data, (e) => {
    const { step, level, ...data } = e.payload;
    const msg = `${e.name}: ${step}`;
    if (level === "warn") logger.warn(msg, data);
    else if (level === "error") logger.error(msg, data);
    else logger.debug(msg, data);
  });

  const taskQueue = new TaskQueue();
  const orchestrator = new InternalTaskOrchestrator(taskQueue, bus);

  const schedulePersistPath = `${sandbox}/${runtime?.appConfig?.schedule?.persistPath ?? "schedule-tasks.json"}`;
  const scheduleService = new ScheduleService(taskQueue, schedulePersistPath, logger);

  const hookPersistPath = `${sandbox}/hooks.json`;
  const hookManager = new HookManager(scheduleService, bus, taskQueue, hookPersistPath, logger);
  hookManagerRef.current = hookManager;
  hookManager.restore();

  const sessionRef: { current: { sessionId: string; chatId: string } | null } = { current: null };
  const scheduleTools = createScheduleTools(hookManagerRef, sessionRef);
  for (const t of scheduleTools) {
    toolRegistry.register(t);
    allTools.push(t);
    toolInfos.push({ name: t.name, source: t.source, description: t.description, online: undefined as boolean | undefined });
  }
  logger.info("schedule tools registered", { count: scheduleTools.length, restored: hookManager.list().length });

  sessionStore.onCreated((sid) => bus.emit(BusEvents.Session.Started as any, { sessionId: sid }));
  sessionStore.onClosed((sid) => {
    skillService?.clearScope?.(sid);
    bus.emit(BusEvents.Session.Closed as any, { sessionId: sid });
  });
  const sessionSweepTimer = setInterval(() => sessionStore.sweepIdle(), 60_000);
  sessionSweepTimer.unref?.();

  bus.on(BusEvents.Conversation.Chain as any, (e: { name: string; payload: { sessionId: string; chatId: string; parentTaskId: string; ownerTaskId?: string; action: ConversationChainAction } }) => {
    const p = e.payload;
    const session = sessionStore.get(p.sessionId);
    logger.debug("conversation chain: handler entered", { action: p.action, sessionMsgCount: session.messages.length, chainDepth: session.chainDepth });

    if (p.action === "post_check_retry") {
      const depth = session.chainDepth;
      if (depth >= maxChainDepth) {
        logger.debug("conversation chain: post_check_retry depth exceeded, ending chain", { depth, maxChainDepth });
        return;
      }
      if (session.pendingPrediction) {
        session.pendingPrediction.contextRelevance = "continuation";
      }
      session.incrementChainDepth();
      orchestrator.scheduleFollowUp(p.sessionId, p.chatId, p.parentTaskId, p.ownerTaskId);
      return;
    }

    const depth = session.chainDepth;

    if (p.action === "continue_todo") {
      const decision = decideTodoContinuation(session.todoState, depth, maxChainDepth);
      if (decision === "complete") {
        logger.debug("conversation chain: TODO continuation completed, ending chain", { todoCount: session.todoState.length });
        return;
      }
      if (decision === "limit_reached") {
        logger.debug("conversation chain: TODO continuation depth exceeded, ending chain", { depth, maxChainDepth });
        return;
      }
      if (session.pendingPrediction) {
        session.pendingPrediction.contextRelevance = "continuation";
      }
      session.incrementChainDepth();
      orchestrator.scheduleTodoContinuation(p.sessionId, p.chatId, p.parentTaskId, p.ownerTaskId);
      return;
    }

    if (session.pendingPrediction) {
      session.pendingPrediction.contextRelevance = "continuation";
    }

    if (depth >= maxChainDepth) {
      logger.debug("conversation chain: depth exceeded, scheduling evaluator", { depth, action: p.action });
      orchestrator.scheduleEvaluator(p.sessionId, p.chatId, p.parentTaskId, p.ownerTaskId);
      return;
    }
    if (depth >= 3 && depth % 3 === 0) {
      logger.debug("conversation chain: periodic evaluator", { depth, action: p.action });
      orchestrator.scheduleEvaluator(p.sessionId, p.chatId, p.parentTaskId, p.ownerTaskId);
      return;
    }
    session.incrementChainDepth();
    orchestrator.scheduleFollowUp(p.sessionId, p.chatId, p.parentTaskId, p.ownerTaskId);
  });

  bus.on(BusEvents.Conversation.Idle as any, (e: { name: string; payload: { sessionId: string; chatId: string; parentTaskId: string; ownerTaskId?: string } }) => {
    const p = e.payload;
    logger.debug("conversation idle: scheduling post-conversation check", { sessionId: p.sessionId });
    orchestrator.schedulePostConversation(p.sessionId, p.chatId, p.parentTaskId, p.ownerTaskId);
  });

  const taskEngine = new TaskEngine({
    bus,
    queue: taskQueue,
    pipelineBuilders,
    discardChain: (chainId, sessionId) => orchestrator.discardChain(chainId, sessionId),
  });
  taskEngine.start();

  const broadcaster = new Broadcaster();
  registerTransportBridge(bus, broadcaster);
  const wsHandlers = createWsHandlers({
    broadcaster,
    taskQueue,
    bus,
    logger,
    orchestrator,
    sessionStore,
    taskEngine,
    isStopping: () => stopping,
  });

  let stopping = false;
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
        if (stopping) return Response.json({ error: "Core is stopping" }, { status: 503 });
        const body = await req.json().catch(() => ({})) as TaskRequestBody;
        const normalized = {
          ...body,
          sessionId: body.sessionId ?? "default",
          chatId: body.chatId ?? "default",
        };
        if (body.data?.text && !sessionStore.checkpointUserMessage(normalized.sessionId, body.data.text)) {
          return Response.json({ error: "Failed to persist session message" }, { status: 500 });
        }
        return createTaskHandler(taskQueue, normalized, bus);
      }
      if (url.pathname.startsWith(`${API_PREFIX}sessions/`) && method === "GET") {
        const sid = url.pathname.split("/").pop()!;
        const session = sessionStore.load(sid);
        return session
          ? Response.json(session.messages)
          : Response.json({ error: "Session not found" }, { status: 404 });
      }
      if (url.pathname.startsWith(`${API_PREFIX}sessions/`) && method === "DELETE") {
        const sid = url.pathname.split("/").pop()!;
        if (!sessionStore.delete(sid)) {
          return Response.json({ error: "Session is active" }, { status: 409 });
        }
        return Response.json({ ok: true, sessionId: sid });
      }
      if (url.pathname.startsWith(`${API_PREFIX}tasks/`) && method === "DELETE") {
        const taskId = url.pathname.split("/").pop()!;
        return taskCancelHandler(taskEngine, req, taskId);
      }
      if (url.pathname.startsWith(`${API_PREFIX}tasks/`) && method === "GET") {
        return taskStatusHandler(taskQueue, url.pathname.split("/").pop()!);
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: wsHandlers,
  });

  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      stopping = true;
      clearInterval(sessionSweepTimer);
      server.stop(false);
      hookManager.stop();
      scheduleService.stop();
      while (!await taskEngine.drain({ timeoutMs: 30_000 })) {
        logger.warn("waiting for queued and active tasks before shutdown");
      }
      sessionStore.suspendAll("shutdown");
      const failedCheckpoints = sessionStore.size;
      if (failedCheckpoints > 0) {
        logger.error("session checkpoint failed during shutdown", { remaining: failedCheckpoints });
        throw new Error(`Failed to persist ${failedCheckpoints} session(s) during shutdown`);
      }
      mcpHealthStopRef.current();
      bus.emit(BusEvents.Context.CoreStopped, {});
      contextService.stop();
      await closeMCPClients(mcpClients);
      await server.stop(true);
    })().catch(error => {
      stopPromise = null;
      throw error;
    });
    return stopPromise;
  };

  logger.info("core ready", { port: server.port, address: host });
  return {
    port: server.port!,
    tools: allTools.map((t: any) => t.name),
    toolInfos,
    mcpServerInfos,
    stop,
  };
}
