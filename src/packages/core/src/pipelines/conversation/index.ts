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

import { DEFAULT_MAX_TOKENS } from "../../constants";

export function registerConversationElements(): void {
  registerElement("collect-prompts", CollectPromptsElement);
  registerElement("load-system-prompt", LoadSystemPromptElement);
  registerElement("fetch-agents-prompt", FetchAgentsPromptElement);
  registerElement("collect-context", CollectContextElement);
  registerElement("format-system-messages", FormatSystemMessagesElement);
  registerElement("format-user-messages", FormatUserMessagesElement);
  registerElement("parse-intents", ParseIntentsElement);
  registerElement("stream-llm", StreamLLMElement);
  registerElement("check-follow-up", CheckFollowUpElement);
  registerElement("finalize", FinalizeElement);
}

export type ConversationPipelineDeps = {
  session: any;
  task: any;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  thinking?: string;
  providerOptions?: Record<string, any>;
  providerModel?: string;
  configContextLimit?: number;
  tools: any[];
  toolTier?: "basic" | "advanced";
  getCompiledPrompt?: () => string;
  maxTokens?: number;
  memory?: any;
  queue?: any;
  orchestrator?: any;
  buildChainPipeline?: (taskId: string, sessionId: string, chatId: string, chainDepth: number) => void;
  chainDepth?: number;
};

export function conversationPipeline(deps: ConversationPipelineDeps) {
  return pipeline("conversation")
    .source("collect-prompts", { session: deps.session, task: deps.task })
    .transform("load-system-prompt", {})
    .transform("fetch-agents-prompt", {
      getCompiledPrompt: deps.getCompiledPrompt ?? (() => ""),
    })
    .transform("collect-context", { memory: deps.memory, sandbox: deps.task?.sandbox, session: deps.session, providerModel: deps.providerModel, configContextLimit: deps.configContextLimit })
    .transform("format-system-messages", {})
    .transform("format-user-messages", {})
    .transform("stream-llm", {
      apiKey: deps.apiKey ?? "",
      model: deps.model ?? "deepseek-chat",
      baseUrl: deps.baseUrl,
      tools: deps.tools ?? [],
      maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
      providerOptions: deps.providerOptions,
    })
    .transform("parse-intents", {})
    .boundary("check-follow-up", { memory: deps.memory })
    .sink("finalize", { orchestrator: deps.orchestrator, buildChainPipeline: deps.buildChainPipeline, chainDepth: deps.chainDepth ?? 0 });
}
