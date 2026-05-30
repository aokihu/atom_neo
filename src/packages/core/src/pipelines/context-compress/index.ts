import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  CompressInputElement,
  CompressSummarizeElement,
  CompressFinalizeElement,
} from "./elements";
import type { InternalTaskOrchestrator } from "../../task/internal-task-orchestrator";

export function registerContextCompressElements(): void {
  registerElement("compress-input", CompressInputElement);
  registerElement("compress-summarize", CompressSummarizeElement);
  registerElement("compress-finalize", CompressFinalizeElement);
}

export function contextCompressPipeline(deps: {
  session: any;
  task: any;
  apiKey: string;
  model: string;
  baseUrl?: string;
  orchestrator: InternalTaskOrchestrator;
  sandbox: string;
}) {
  return pipeline("context-compress")
    .source("compress-input", { session: deps.session })
    .transform("compress-summarize", {
      apiKey: deps.apiKey,
      model: deps.model,
      baseUrl: deps.baseUrl,
    })
    .sink("compress-finalize", {
      orchestrator: deps.orchestrator,
      sandbox: deps.sandbox,
    });
}
