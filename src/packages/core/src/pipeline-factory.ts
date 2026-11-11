/**
 * Pipeline factory: resolves models/limits and builds the five Core pipelines.
 * Pure construction only — no task scheduling or lifecycle side effects.
 */
import type { FullEventMap, PipelineEventBus, ProviderProtocol, ToolDefinition } from "@atom-neo/shared";
import type { ResolvedModel as SharedResolvedModel } from "@atom-neo/shared";
import { inferProviderProtocol } from "@atom-neo/shared";
import { DEFAULT_MAX_TOKENS, resolveContextLimit } from "./constants";
import { providerOptionsFor } from "./pipelines/shared/model-provider";
import { conversationPipeline } from "./pipelines/conversation";
import { predictionPipeline } from "./pipelines/prediction";
import { followUpEvaluatorPipeline } from "./pipelines/follow-up-evaluator";
import { contextCompressPipeline } from "./pipelines/context-compress";
import { postConversationPipeline } from "./pipelines/post-conversation";
import type { ContextService } from "./context/context-service";
import type { InternalTaskOrchestrator } from "./task/internal-task-orchestrator";
import type { SessionPersistenceService } from "./session/persistence-service";
import type { SessionStore } from "./session/store";
import type { SkillServiceLike } from "./skills/types";
import type { Pipeline } from "./pipeline/builder";

/** Local extension of the shared model shape: fake runtimes may omit protocol/type. */
export type ResolvedModel = Omit<SharedResolvedModel, "protocol" | "type"> & {
  protocol?: ProviderProtocol;
  type?: "llm" | "jev";
  beforeCall?: (signal?: AbortSignal) => Promise<void>;
};

export interface RuntimeLike {
  sandbox: string;
  appConfig: Record<string, any>;
  maxTokens: number;
  getResolvedModel(level?: string): ResolvedModel;
  updateRuntimeConfig?(patch: unknown): Record<string, any>;
  resetRuntimeConfig?(): Record<string, any>;
}

export type BudgetLimits = {
  maxGlobalRounds: number;
  maxLocalRounds: number;
};

/** Fallback used by fake runtimes and the TUI attach response. */
export function resolveInitialModel(runtime: RuntimeLike): ResolvedModel {
  return runtime?.getResolvedModel?.("balanced") ?? {
    provider: "deepseek", protocol: "deepseek" as const, model: "deepseek-v4-flash", apiKey: "",
  };
}

export function budgetLimitsFor(runtime: RuntimeLike): BudgetLimits {
  return {
    maxGlobalRounds: runtime.appConfig?.conversation?.maxGlobalRounds
      ?? (runtime.appConfig?.conversation?.maxChainDepth === undefined ? 100 : runtime.appConfig.conversation.maxChainDepth + 1),
    maxLocalRounds: runtime.appConfig?.conversation?.maxLocalRounds ?? 5,
  };
}

export type PipelineFactoryDeps = {
  runtime: RuntimeLike;
  fallbackModel: ResolvedModel;
  bus: PipelineEventBus<FullEventMap>;
  sessionStore: SessionStore;
  contextService: ContextService;
  persistence: SessionPersistenceService;
  orchestrator: InternalTaskOrchestrator;
  allTools: ToolDefinition[];
  mcpToolsRef: { current: Record<string, any> };
  getCompiledPrompt: () => string;
  skillService?: SkillServiceLike;
  memory: unknown;
  sandbox: string;
};

export type PipelineBuilders = Record<string, (task: any) => Pipeline>;

/** Build the pipeline map used by TaskEngine; model selection matches the legacy startCore closures. */
export function createPipelineFactory(deps: PipelineFactoryDeps): PipelineBuilders {
  const { runtime, sessionStore, contextService, persistence, orchestrator, allTools } = deps;
  const resolved = deps.fallbackModel;

  // Fake runtimes may predate the protocol field; infer it from the provider id
  // and configuration rather than assuming DeepSeek.
  const normalizeModel = (model: ResolvedModel) => ({
    ...model,
    protocol: model.protocol ?? inferProviderProtocol(model.provider, runtime?.appConfig?.providers?.[model.provider]),
  });
  const getModel = (level: string) => normalizeModel(runtime?.getResolvedModel?.(level) ?? resolved);
  const getContextLimit = (selected: ResolvedModel) => resolveContextLimit(
    `${selected.provider}/${selected.model}`, runtime?.appConfig?.providers?.[selected.provider]?.contextLimit,
  );
  const decisionDeps = (purpose: "prediction" | "postConversation" | "continuation") => {
    const selected = getModel("fast");
    const fallback = getModel("basic");
    return {
      decisionMode: runtime.appConfig?.decisionMode?.[purpose],
      decisionModel: {
        type: selected.type ?? "llm",
        provider: selected.provider,
        protocol: selected.protocol,
        options: selected.options,
        apiKey: selected.apiKey,
        model: selected.model,
        baseUrl: selected.baseUrl,
        thinking: selected.thinking,
        beforeCall: selected.beforeCall,
      },
      fallbackModel: {
        provider: fallback.provider,
        protocol: fallback.protocol,
        options: fallback.options,
        apiKey: fallback.apiKey,
        model: fallback.model,
        baseUrl: fallback.baseUrl,
        thinking: fallback.thinking,
        beforeCall: fallback.beforeCall,
      },
    };
  };
  const budgetLimits = () => budgetLimitsFor(runtime);

  return {
    prediction: (task: any) => {
      const session = sessionStore.get(task.sessionId);
      const selected = getModel("balanced");
      const maxTokens = runtime.maxTokens ?? DEFAULT_MAX_TOKENS;
      return predictionPipeline({
        maxGlobalRounds: budgetLimits().maxGlobalRounds,
        session,
        task,
        apiKey: selected.apiKey, model: selected.model, provider: selected.provider, protocol: selected.protocol,
        baseUrl: selected.baseUrl, thinking: selected.thinking, options: selected.options, maxTokens,
        ...decisionDeps("prediction"),
        orchestrator,
        configContextLimit: getContextLimit(selected),
        skillService: deps.skillService,
      }).build(deps.bus);
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
      const topicId = session.currentTopic || undefined;
      const upgradeModel = contextService.get(
        topicId ? "topic" : "session",
        { sessionId: session.sessionId, ...(topicId ? { topicId } : {}) },
        "model-upgrade",
      );
      const effectiveProfile = upgradeModel
        ? "advanced"
        : DIFFICULTY_PROFILE[prediction.difficulty] ?? prediction.modelProfile;

      const resolvedModel = normalizeModel(runtime.getResolvedModel
        ? runtime.getResolvedModel(effectiveProfile)
        : resolved);
      const maxTokens = runtime.maxTokens ?? DEFAULT_MAX_TOKENS;

      return conversationPipeline({
        ...decisionDeps("continuation"),
        session,
        task,
        apiKey: resolvedModel.apiKey,
        model: resolvedModel.model,
        provider: resolvedModel.provider,
        protocol: resolvedModel.protocol,
        baseUrl: resolvedModel.baseUrl,
        beforeCall: resolvedModel.beforeCall,
        providerModel: `${resolvedModel.provider}/${resolvedModel.model}`,
        configContextLimit: getContextLimit(resolvedModel),
        providerOptions: providerOptionsFor(resolvedModel),
        tools: allTools,
        mcpToolsRef: deps.mcpToolsRef,
        getCompiledPrompt: deps.getCompiledPrompt,
        maxTokens,
        maxSteps: runtime.appConfig?.conversation?.maxSteps ?? 50,
        memory: deps.memory,
        intent: prediction.intent,
        contextRelevance: prediction.contextRelevance,
        sandbox: deps.sandbox,
        orchestrator,
        skillService: deps.skillService,
        contextService,
        toolRecordStore: persistence.toolRecords,
      }).build(deps.bus);
    },

    "follow-up-evaluator": (task: any) => {
      const session = sessionStore.get(task.sessionId);
      const selected = getModel("balanced");
      const maxTokens = runtime.maxTokens ?? DEFAULT_MAX_TOKENS;
      return followUpEvaluatorPipeline({
        ...decisionDeps("continuation"),
        toolRecordStore: persistence.toolRecords,
        session,
        task,
        apiKey: selected.apiKey, model: selected.model, provider: selected.provider, protocol: selected.protocol,
        baseUrl: selected.baseUrl, options: selected.options, maxTokens,
        orchestrator,
        configContextLimit: getContextLimit(selected),
        contextService,
      }).build(deps.bus);
    },

    "context-compress": (task: any) => {
      const session = sessionStore.get(task.sessionId);
      const selected = getModel("basic");
      return contextCompressPipeline({
        session,
        task,
        apiKey: selected.apiKey,
        model: selected.model,
        provider: selected.provider,
        protocol: selected.protocol,
        baseUrl: selected.baseUrl,
        thinking: selected.thinking,
        options: selected.options,
        orchestrator,
        sandbox: deps.sandbox,
        configContextLimit: getContextLimit(selected),
        maxTokens: runtime.maxTokens ?? DEFAULT_MAX_TOKENS,
        contextService,
        persistence,
      }).build(deps.bus);
    },

    "post-conversation": (task: any) => {
      const session = sessionStore.get(task.sessionId);
      const selected = getModel("balanced");
      const maxTokens = runtime.maxTokens ?? DEFAULT_MAX_TOKENS;
      return postConversationPipeline({
        session,
        task,
        apiKey: selected.apiKey, model: selected.model, provider: selected.provider, protocol: selected.protocol,
        baseUrl: selected.baseUrl, thinking: selected.thinking, options: selected.options, maxTokens,
        providerModel: `${selected.provider}/${selected.model}`,
        ...decisionDeps("postConversation"),
        configContextLimit: getContextLimit(selected),
        contextService,
      }).build(deps.bus);
    },
  };
}
