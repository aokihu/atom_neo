import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  CollectPromptsElement,
  LoadSystemPromptElement,
  FetchAgentsPromptElement,
  CollectContextElement,
  FormatSystemMessagesElement,
  FormatUserMessagesElement,
  ParseIntentsElement,
  StreamLLMElement,
  CheckFollowUpElement,
  FinalizeElement,
} from "./elements";

export function registerConversationElements(): void {
  registerElement("collect-prompts", CollectPromptsElement as any);
  registerElement("load-system-prompt", LoadSystemPromptElement as any);
  registerElement("fetch-agents-prompt", FetchAgentsPromptElement as any);
  registerElement("collect-context", CollectContextElement as any);
  registerElement("format-system-messages", FormatSystemMessagesElement as any);
  registerElement("format-user-messages", FormatUserMessagesElement as any);
  registerElement("parse-intents", ParseIntentsElement as any);
  registerElement("stream-llm", StreamLLMElement as any);
  registerElement("check-follow-up", CheckFollowUpElement as any);
  registerElement("finalize", FinalizeElement as any);
}

export type ConversationPipelineDeps = {
  session: any;
  task: any;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  tools: any[];
  toolTier?: "basic" | "advanced";
  getCompiledPrompt?: () => string;
  maxTokens?: number;
  memory?: any;
  queue?: any;
  buildChainPipeline?: (taskId: string, sessionId: string, chatId: string) => void;
};

export function conversationPipeline(deps: ConversationPipelineDeps) {
  return pipeline("conversation")
    .source("collect-prompts", { session: deps.session, task: deps.task })
    .transform("load-system-prompt", {})
    .transform("fetch-agents-prompt", {
      getCompiledPrompt: deps.getCompiledPrompt ?? (() => ""),
    })
    .transform("collect-context", { memory: deps.memory })
    .transform("format-system-messages", {})
    .transform("format-user-messages", {})
    .transform("stream-llm", {
      apiKey: deps.apiKey ?? "",
      model: deps.model ?? "deepseek-chat",
      baseUrl: deps.baseUrl,
      tools: deps.tools ?? [],
      maxTokens: deps.maxTokens ?? 4096,
    })
    .transform("parse-intents", {})
    .boundary("check-follow-up", { memory: deps.memory })
    .sink("finalize", { queue: deps.queue, buildChainPipeline: deps.buildChainPipeline });
}
