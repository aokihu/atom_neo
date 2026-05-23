import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  CollectPromptsElement,
  LoadSystemPromptElement,
  FetchAgentsPromptElement,
  CollectContextElement,
  FormatMessagesElement,
  StreamLLMElement,
  CheckFollowUpElement,
  FinalizeElement,
} from "./elements";

export function registerConversationElements(): void {
  registerElement("collect-prompts", CollectPromptsElement as any);
  registerElement("load-system-prompt", LoadSystemPromptElement as any);
  registerElement("fetch-agents-prompt", FetchAgentsPromptElement as any);
  registerElement("collect-context", CollectContextElement as any);
  registerElement("format-messages", FormatMessagesElement as any);
  registerElement("stream-llm", StreamLLMElement as any);
  registerElement("check-follow-up", CheckFollowUpElement as any);
  registerElement("finalize", FinalizeElement as any);
}

export type ConversationPipelineDeps = {
  session: any;
  task: any;
  apiKey?: string;
  model?: string;
  tools: any[];
  toolTier?: "basic" | "advanced";
  getCompiledPrompt?: () => string;
  maxTokens?: number;
};

export function conversationPipeline(deps: ConversationPipelineDeps) {
  return pipeline("conversation")
    .source("collect-prompts", { session: deps.session, task: deps.task })
    .transform("load-system-prompt", {})
    .transform("fetch-agents-prompt", {
      getCompiledPrompt: deps.getCompiledPrompt ?? (() => ""),
    })
    .transform("collect-context", {})
    .transform("format-messages", {})
    .transform("stream-llm", {
      apiKey: deps.apiKey ?? "",
      model: deps.model ?? "deepseek-chat",
      tools: deps.tools ?? [],
      maxTokens: deps.maxTokens ?? 4096,
    })
    .boundary("check-follow-up", {})
    .sink("finalize", {});
}
