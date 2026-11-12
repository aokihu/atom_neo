import { pipeline } from "../../pipeline/builder";
import type { ElementRegistry } from "../../pipeline/registry";
import {
  CollectInputElement,
  AnalyzeResultElement,
  PostConversationFinalizeElement,
} from "./elements";
import type { ContextService } from "../../context/context-service";
import type { DecisionModel } from "../../decision/choose";
import type { PromptResolver, ProviderProtocol } from "@atom-neo/shared";

export function registerPostConversationElements(registry: ElementRegistry): void {
  registry.register("post-collect-input", CollectInputElement);
  registry.register("post-analyze-result", AnalyzeResultElement);
  registry.register("post-finalize", PostConversationFinalizeElement);
}

export function postConversationPipeline(deps: {
  elementRegistry: ElementRegistry;
  session: any;
  task: any;
  promptResolver: PromptResolver;
  apiKey: string;
  model: string;
  provider?: string;
  protocol?: ProviderProtocol;
  baseUrl?: string;
  thinking?: string;
  options?: Record<string, unknown>;
  providerModel?: string;
  decisionMode?: "legacy" | "jev";
  decisionModel?: DecisionModel;
  fallbackModel?: DecisionModel;
  maxTokens?: number;
  configContextLimit?: number;
  contextService: ContextService;
}) {
  return pipeline("post-conversation", deps.elementRegistry)
    .source("post-collect-input", { session: deps.session })
    .transform(deps.decisionMode === "jev" ? "jev-decision" : "post-analyze-result", deps.decisionMode === "jev"
      ? { purpose: "post-conversation", model: deps.decisionModel, fallback: deps.fallbackModel, promptResolver: deps.promptResolver, maxTokens: deps.maxTokens }
      : {
        promptResolver: deps.promptResolver,
        apiKey: deps.apiKey,
        model: deps.model,
        provider: deps.provider,
        protocol: deps.protocol,
        baseUrl: deps.baseUrl,
        thinking: deps.thinking,
        options: deps.options,
        maxTokens: deps.maxTokens,
      })
    .boundary("token-ratio", { session: deps.session, configContextLimit: deps.configContextLimit, maxTokens: deps.maxTokens })
    .sink("post-finalize", { contextService: deps.contextService, promptResolver: deps.promptResolver, providerModel: deps.providerModel });
}
