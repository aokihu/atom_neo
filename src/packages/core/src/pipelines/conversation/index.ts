import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  CollectPromptsElement,
  LoadSystemPromptElement,
  FetchAgentsPromptElement,
  CollectContextElement,
  FormatSystemMessagesElement,
  FormatUserMessagesElement,
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
  getCompiledPrompt?: () => string;
  maxTokens?: number;
  maxSteps?: number;
  memory?: any;
  taskIntent?: string;
  contextRelevance?: string;
  sandbox?: string;
};

export function conversationPipeline(deps: ConversationPipelineDeps) {
  return pipeline("conversation")
    .source("collect-prompts", { session: deps.session, task: deps.task, contextRelevance: deps.contextRelevance })
    .transform("load-system-prompt", { providerModel: deps.providerModel })
    .transform("fetch-agents-prompt", {
      getCompiledPrompt: deps.getCompiledPrompt ?? (() => ""),
    })
    .transform("collect-context", { memory: deps.memory, sandbox: deps.sandbox, session: deps.session, providerModel: deps.providerModel, configContextLimit: deps.configContextLimit, taskIntent: deps.taskIntent })
    .transform("format-system-messages", {})
    .transform("format-user-messages", {})
    .transform("stream-llm", {
      apiKey: deps.apiKey ?? "",
      model: deps.model ?? "deepseek-v4-flash",
      baseUrl: deps.baseUrl,
      tools: deps.tools ?? [],
      maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
      maxSteps: deps.maxSteps,
      providerOptions: deps.providerOptions,
      taskIntent: deps.taskIntent,
      session: deps.session,
    })
    .boundary("check-follow-up", { memory: deps.memory })
    .sink("finalize", {});
}
