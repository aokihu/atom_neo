import { pipeline } from "../../pipeline/builder";
import type { ElementRegistry } from "../../pipeline/registry";
import {
  CollectPromptsElement,
  LoadSystemPromptElement,
  FetchAgentsPromptElement,
  CollectContextElement,
  RecordContextElement,
  FormatSystemMessagesElement,
  FormatUserMessagesElement,
  StreamLLMElement,
  CheckFollowUpElement,
  FinalizeElement,
  InjectSkillContextElement,
  ApplySourceContextElement,
} from "./elements";

import { DEFAULT_MAX_TOKENS } from "../../constants";
import type { InternalTaskOrchestrator } from "../../task/internal-task-orchestrator";
import type { SkillServiceLike } from "../../skills/types";
import type { ContextService } from "../../context/context-service";
import type { ToolRecordStore } from "../../tools/tool-record-store";
import type { PromptResolver } from "@atom-neo/shared";
import type { ElementMemory, ElementTask, PipelineSession } from "../../session/element-session";

export function registerConversationElements(registry: ElementRegistry): void {
  registry.register("collect-prompts", CollectPromptsElement);
  registry.register("load-system-prompt", LoadSystemPromptElement);
  registry.register("fetch-agents-prompt", FetchAgentsPromptElement);
  registry.register("collect-context", CollectContextElement);
  registry.register("record-context", RecordContextElement);
  registry.register("format-system-messages", FormatSystemMessagesElement);
  registry.register("format-user-messages", FormatUserMessagesElement);
  registry.register("stream-llm", StreamLLMElement);
  registry.register("check-follow-up", CheckFollowUpElement);
  registry.register("finalize", FinalizeElement);
  registry.register("inject-skill-context", InjectSkillContextElement);
  registry.register("apply-source-context", ApplySourceContextElement);
}

export type ConversationPipelineDeps = {
  elementRegistry: ElementRegistry;
  promptResolver: PromptResolver;
  decisionMode?: "jev" | "rules";
  decisionModel?: import("../../decision/choose").DecisionModel;
  fallbackModel?: import("../../decision/choose").DecisionModel;
  session: PipelineSession;
  task: ElementTask;
  apiKey?: string;
  model?: string;
  provider?: string;
  protocol?: import("@atom-neo/shared").ProviderProtocol;
  baseUrl?: string;
  beforeCall?: (signal?: AbortSignal) => Promise<void>;
  thinking?: string;
  providerOptions?: Record<string, any>;
  providerModel?: string;
  configContextLimit?: number;
  tools: any[];
  mcpToolsRef?: { current: Record<string, any> };
  getCompiledPrompt?: () => string;
  maxTokens?: number;
  maxSteps?: number;
  memory?: ElementMemory;
  intent?: string;
  contextRelevance?: string;
  sandbox?: string;
  orchestrator?: InternalTaskOrchestrator;
  skillService?: SkillServiceLike;
  contextService: ContextService;
  toolRecordStore: ToolRecordStore;
};

export function conversationPipeline(deps: ConversationPipelineDeps) {
  return pipeline("conversation", deps.elementRegistry)
    .source("collect-prompts", { session: deps.session, task: deps.task, contextRelevance: deps.contextRelevance })
    .transform("record-context", {
      contextService: deps.contextService,
      promptResolver: deps.promptResolver,
      sandbox: deps.sandbox,
      session: deps.session,
      providerModel: deps.providerModel,
      configContextLimit: deps.configContextLimit,
      taskIntent: deps.intent,
      getCompiledPrompt: deps.getCompiledPrompt,
      skillService: deps.skillService,
      toolRecordStore: deps.toolRecordStore,
    })
    .transform("apply-source-context", {
      contextService: deps.contextService,
      promptResolver: deps.promptResolver,
      providerModel: deps.providerModel,
    })
    .transform("collect-context", {
      contextService: deps.contextService,
      configContextLimit: deps.configContextLimit,
      maxTokens: deps.maxTokens,
    })
    .transform("stream-llm", {
      apiKey: deps.apiKey ?? "",
      model: deps.model ?? "deepseek-v4-flash",
      provider: deps.provider,
      protocol: deps.protocol,
      baseUrl: deps.baseUrl,
      beforeCall: deps.beforeCall,
      tools: deps.tools ?? [],
      mcpToolsRef: deps.mcpToolsRef,
      maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
      maxSteps: deps.maxSteps,
      providerOptions: deps.providerOptions,
      taskIntent: deps.intent,
      session: deps.session,
      configContextLimit: deps.configContextLimit,
      skillService: deps.skillService,
      contextService: deps.contextService,
      toolRecordStore: deps.toolRecordStore,
      task: deps.task,
      memory: deps.memory,
    })
    .boundary("token-ratio", { session: deps.session, configContextLimit: deps.configContextLimit, maxTokens: deps.maxTokens })
    .boundary("check-follow-up", { memory: deps.memory, session: deps.session, promptResolver: deps.promptResolver, decisionMode: deps.decisionMode, decisionModel: deps.decisionModel, fallbackModel: deps.fallbackModel })
    .sink("finalize", { orchestrator: deps.orchestrator, session: deps.session, configContextLimit: deps.configContextLimit, maxTokens: deps.maxTokens });
}
