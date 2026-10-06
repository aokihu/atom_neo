import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  CollectInputElement,
  AnalyzeResultElement,
  PostConversationFinalizeElement,
} from "./elements";
import type { ContextService } from "../../context/context-service";

export function registerPostConversationElements(): void {
  registerElement("post-collect-input", CollectInputElement);
  registerElement("post-analyze-result", AnalyzeResultElement);
  registerElement("post-finalize", PostConversationFinalizeElement);
}

export function postConversationPipeline(deps: {
  session: any;
  task: any;
  apiKey: string;
  model: string;
  baseUrl?: string;
  decisionMode?: "legacy" | "jev";
  decisionModel?: { type: "llm" | "jev"; apiKey: string; model: string; baseUrl?: string };
  fallbackModel?: { apiKey: string; model: string; baseUrl?: string };
  maxTokens?: number;
  configContextLimit?: number;
  contextService: ContextService;
}) {
  return pipeline("post-conversation")
    .source("post-collect-input", { session: deps.session })
    .transform(deps.decisionMode === "jev" ? "jev-decision" : "post-analyze-result", deps.decisionMode === "jev"
      ? { purpose: "post-conversation", model: deps.decisionModel, fallback: deps.fallbackModel, maxTokens: deps.maxTokens }
      : { apiKey: deps.apiKey, model: deps.model, baseUrl: deps.baseUrl, maxTokens: deps.maxTokens })
    .boundary("token-ratio", { session: deps.session, configContextLimit: deps.configContextLimit, maxTokens: deps.maxTokens })
    .sink("post-finalize", { contextService: deps.contextService });
}
