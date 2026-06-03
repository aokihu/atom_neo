import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  CollectInputElement,
  AnalyzeResultElement,
  PostConversationFinalizeElement,
} from "./elements";

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
  maxTokens?: number;
}) {
  return pipeline("post-conversation")
    .source("post-collect-input", { session: deps.session })
    .transform("post-analyze-result", {
      apiKey: deps.apiKey,
      model: deps.model,
      baseUrl: deps.baseUrl,
      maxTokens: deps.maxTokens,
    })
    .sink("post-finalize", {});
}
