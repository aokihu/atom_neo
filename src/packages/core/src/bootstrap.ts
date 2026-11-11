/**
 * Core composition root: builds the event bus, queue, session/context services,
 * tool registry, MCP lifecycle, schedule/hook managers, pipelines, task lifecycle,
 * broadcaster and WebSocket handlers. HTTP serving stays in server.ts.
 */
import { BusEvents, PipelineEventBus, WsMessages, initPromptRegistry, substringWellFormed } from "@atom-neo/shared";
import type { FullEventMap, Logger, NetworkServiceLike, ToolDefinition } from "@atom-neo/shared";
import { TaskQueue } from "./task-queue";
import { TaskEngine } from "./task-engine";
import { SessionStore } from "./session/store";
import { Broadcaster } from "./ws/broadcaster";
import { buildSessionTelemetry, createWsHandlers } from "./ws/handler";
import { registerTransportBridge } from "./ws/transport-bridge";
import { registerDecisionBridge } from "./ws/decision-bridge";
import { TaskSubmissionService } from "./task/task-submission-service";
import { ToolRegistry } from "./tools/registry";
import { registerBuiltinTools, createAllTools } from "./tools/bootstrap";
import { BackgroundShellService, formatBackgroundShellCompletion } from "./tools/builtin/shell";
import { ScheduleService } from "./tools/schedule-service";
import { HookManager } from "./hooks/hook-manager";
import { createScheduleTools } from "./tools/builtin/schedule";
import { createSkillTools } from "./tools/builtin/skill";
import type { SkillServiceLike } from "./skills/types";
import { registerConversationElements } from "./pipelines/conversation";
import { registerPredictionElements } from "./pipelines/prediction";
import { registerFollowUpElements } from "./pipelines/follow-up";
import { registerFollowUpEvaluatorElements } from "./pipelines/follow-up-evaluator";
import { registerContextCompressElements } from "./pipelines/context-compress";
import { registerPostConversationElements } from "./pipelines/post-conversation";
import { registerSharedElements } from "./pipelines/shared";
import { InternalTaskOrchestrator } from "./task/internal-task-orchestrator";
import { ContextService } from "./context/context-service";
import { prepareBudgetRelease } from "./session/execution-budget";
import { SessionPersistenceService } from "./session/persistence-service";
import { budgetLimitsFor, createPipelineFactory, resolveInitialModel } from "./pipeline-factory";
import type { BudgetLimits, PipelineBuilders, ResolvedModel, RuntimeLike } from "./pipeline-factory";
import { registerTaskLifecycle } from "./task-lifecycle";
import { createMcpLifecycle } from "./mcp-lifecycle";
import type { McpLifecycle, McpServerInfo } from "./mcp-lifecycle";

interface CompilerLike {
  getCompiledPrompt(): string;
}

interface ServiceProvider {
  get<T>(name: string): T | undefined;
}

export type CoreDeps = {
  port: number;
  host: string;
  logger: Logger;
  sm: ServiceProvider;
  runtime: RuntimeLike;
  version?: string;
  adminToken?: string;
  allowRemoteAdmin?: boolean;
};

export type ToolInfo = {
  name: string;
  source: string;
  description: string;
  online?: boolean;
};

export type CoreBootstrapOptions = CoreDeps & {
  isStopping: () => boolean;
};

export type CoreBootstrap = {
  bus: PipelineEventBus<FullEventMap>;
  taskQueue: TaskQueue;
  orchestrator: InternalTaskOrchestrator;
  contextService: ContextService;
  persistence: SessionPersistenceService;
  sessionStore: SessionStore;
  taskSubmission: TaskSubmissionService;
  allTools: ToolDefinition[];
  toolInfos: ToolInfo[];
  fallbackModel: ResolvedModel;
  budgetLimits: () => BudgetLimits;
  taskEngine: TaskEngine;
  broadcaster: Broadcaster;
  hookManager: HookManager;
  scheduleService: ScheduleService;
  backgroundShell: BackgroundShellService;
  mcp: McpLifecycle;
  sessionSweepTimer: ReturnType<typeof setInterval>;
  wsHandlers: ReturnType<typeof createWsHandlers>;
  pipelineBuilders: PipelineBuilders;
  getMcpServerInfos: () => McpServerInfo[];
};

/** Build every Core collaborator in the startup order required by the pipeline runtime. */
export function createCoreBootstrap(options: CoreBootstrapOptions): CoreBootstrap {
  const { logger, sm, runtime, isStopping } = options;
  const sandbox: string = runtime.sandbox ?? "";
  const fallbackModel = resolveInitialModel(runtime);
  const budgetLimits = () => budgetLimitsFor(runtime);

  const memory = sm.get("memory");
  const skillService = sm.get<SkillServiceLike>("skill");
  const network = sm.get<NetworkServiceLike>("network");
  if (!network) throw new Error('Required service "network" is not registered');
  const getCompiledPrompt = () => {
    const compiler = sm.get<CompilerLike>("agents-compiler");
    return compiler?.getCompiledPrompt() ?? "";
  };

  const bus = new PipelineEventBus<FullEventMap>();
  bus.onHandlerError((eventName, error) => logger.error("event handler failed", { eventName, error: String(error) }));
  const taskQueue = new TaskQueue();
  const orchestrator = new InternalTaskOrchestrator(taskQueue, bus);
  const contextService = new ContextService(bus);
  contextService.start();
  const persistence = new SessionPersistenceService(sandbox, contextService);
  const sessionStore = new SessionStore(1000, (msg, ctx) => logger.debug(msg, ctx), undefined, persistence);
  const taskSubmission = new TaskSubmissionService({
    taskQueue,
    bus,
    sessionStore,
    releaseTask: task => orchestrator.releaseTask(task),
  });
  orchestrator.setReleaseGuard(task => prepareBudgetRelease({
    session: sessionStore.get(task.sessionId), task, limits: budgetLimits(),
    save: () => sessionStore.save(task.sessionId, "task_completed"),
    report: (step, data) => logger.debug(`execution budget: ${step}`, data),
    notify: text => bus.emit(BusEvents.Transport.Delta, { name: "execution-budget", payload: {
      sessionId: task.sessionId, taskId: task.parentTaskId ?? task.id, textDelta: `\n\n${text}`, offset: 0,
    } }),
  }));
  const backgroundShell = new BackgroundShellService({
    sandbox,
    onComplete: result => orchestrator.scheduleConversation(
      result.sessionId,
      result.chatId,
      result.parentTaskId,
      [{ type: "text", data: formatBackgroundShellCompletion(result) }],
    ),
  });

  const toolDependencies = {
    sandbox,
    network,
    whitelist: runtime?.appConfig?.permission?.whitelist ?? [],
    persistence,
    backgroundShell,
  };
  const allTools = createAllTools({ ...toolDependencies, memory });
  if (skillService) {
    allTools.push(...createSkillTools(skillService));
  }

  const toolInfos: ToolInfo[] = allTools.map(t => ({ name: t.name, source: t.source as string, description: t.description, online: undefined }));
  const broadcaster = new Broadcaster();
  const mcp = createMcpLifecycle({
    configs: runtime?.appConfig?.mcpServers ?? [],
    logger,
    broadcaster,
    isStopping,
    getTotalToolCount: () => allTools.length,
  });
  mcp.start();

  const pipelineBuilders = createPipelineFactory({
    runtime,
    fallbackModel,
    bus,
    sessionStore,
    contextService,
    persistence,
    orchestrator,
    allTools,
    mcpToolsRef: mcp.toolRef,
    getCompiledPrompt,
    skillService,
    memory,
    sandbox,
  });

  const toolRegistry = new ToolRegistry();
  registerBuiltinTools(toolRegistry, toolDependencies);
  logger.info("tools registered", { count: toolRegistry.getAll().length });

  initPromptRegistry();
  registerConversationElements();
  registerPredictionElements();
  registerFollowUpElements();
  registerFollowUpEvaluatorElements();
  registerContextCompressElements();
  registerPostConversationElements();
  registerSharedElements();

  const sessionRef: { current: { sessionId: string; chatId: string } | null } = { current: null };
  registerTaskLifecycle({ bus, logger, taskQueue, orchestrator, sessionStore, broadcaster, sessionRef });

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

  const schedulePersistPath = `${sandbox}/${runtime?.appConfig?.schedule?.persistPath ?? "schedule-tasks.json"}`;
  const scheduleService = new ScheduleService(taskQueue, schedulePersistPath, logger, task => orchestrator.releaseTask(task));

  const hookPersistPath = `${sandbox}/hooks.json`;
  const hookManager = new HookManager(scheduleService, bus, taskQueue, hookPersistPath, logger, task => orchestrator.releaseTask(task));
  const hookManagerRef: { current: HookManager | null } = { current: hookManager };
  hookManager.restore();

  const scheduleTools = createScheduleTools(hookManagerRef, sessionRef);
  for (const t of scheduleTools) {
    toolRegistry.register(t);
    allTools.push(t);
    toolInfos.push({ name: t.name, source: t.source, description: t.description, online: undefined });
  }
  logger.info("schedule tools registered", { count: scheduleTools.length, restored: hookManager.list().length });

  sessionStore.onCreated((sid) => bus.emit(BusEvents.Session.Started, { sessionId: sid }));
  sessionStore.onClosed((sid) => {
    skillService?.clearScope?.(sid);
    bus.emit(BusEvents.Session.Closed, { sessionId: sid });
  });
  const sessionSweepTimer = setInterval(() => sessionStore.sweepIdle(), 60_000);
  sessionSweepTimer.unref?.();

  const taskEngine = new TaskEngine({
    bus,
    queue: taskQueue,
    pipelineBuilders,
    discardChain: (chainId, sessionId) => orchestrator.discardChain(chainId, sessionId),
  });
  taskEngine.start();

  sessionStore.onSaved(session => broadcaster.broadcastToSession(session.sessionId,
    WsMessages.Server.SessionTelemetry, buildSessionTelemetry(session, budgetLimits().maxLocalRounds)));
  registerTransportBridge(bus, broadcaster);
  registerDecisionBridge(bus, broadcaster);
  const wsHandlers = createWsHandlers({
    getLocalRoundLimit: () => budgetLimits().maxLocalRounds,
    broadcaster,
    taskQueue,
    bus,
    logger,
    orchestrator,
    sessionStore,
    taskEngine,
    taskSubmission,
    isStopping,
  });

  return {
    bus,
    taskQueue,
    orchestrator,
    contextService,
    persistence,
    sessionStore,
    taskSubmission,
    allTools,
    toolInfos,
    fallbackModel,
    budgetLimits,
    taskEngine,
    broadcaster,
    hookManager,
    scheduleService,
    backgroundShell,
    mcp,
    sessionSweepTimer,
    wsHandlers,
    pipelineBuilders,
    getMcpServerInfos: () => mcp.getServerInfos(),
  };
}
