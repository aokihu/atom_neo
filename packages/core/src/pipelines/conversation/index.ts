import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  CollectPromptsElement,
  FormatMessagesElement,
  StreamLLMElement,
  CheckFollowUpElement,
  FinalizeElement,
} from "./elements";

export function registerConversationElements(): void {
  registerElement("collect-prompts", CollectPromptsElement as any);
  registerElement("format-messages", FormatMessagesElement as any);
  registerElement("stream-llm", StreamLLMElement as any);
  registerElement("check-follow-up", CheckFollowUpElement as any);
  registerElement("finalize", FinalizeElement as any);
}

export type ConversationPipelineDeps = {
  session: any;
  task: any;
};

export function conversationPipeline(deps: ConversationPipelineDeps) {
  return pipeline("conversation")
    .source("collect-prompts", { session: deps.session, task: deps.task })
    .transform("format-messages", {})
    .transform("stream-llm", {})
    .boundary("check-follow-up", {})
    .sink("finalize", {});
}
