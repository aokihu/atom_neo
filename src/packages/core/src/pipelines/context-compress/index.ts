import { pipeline } from "../../pipeline/builder";
import { registerElement } from "../../pipeline/registry";
import {
  CompressInputElement,
  CompressArchiveElement,
  CompressSummarizeElement,
  CompressFinalizeElement,
} from "./elements";
import type { InternalTaskOrchestrator } from "../../task/internal-task-orchestrator";
import type { ContextService } from "../../context/context-service";
import type { SessionPersistenceService } from "../../session/persistence-service";

export function registerContextCompressElements(): void {
  registerElement("compress-input", CompressInputElement);
  registerElement("compress-archive", CompressArchiveElement);
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
  configContextLimit?: number;
  maxTokens?: number;
  contextService: ContextService;
  persistence: SessionPersistenceService;
}) {
  return pipeline("context-compress")
    .source("compress-input", { session: deps.session, contextService: deps.contextService })
    .transform("compress-archive", { persistence: deps.persistence })
    .transform("compress-summarize", {
      apiKey: deps.apiKey,
      model: deps.model,
      baseUrl: deps.baseUrl,
    })
    .boundary("token-ratio", { session: deps.session, configContextLimit: deps.configContextLimit, maxTokens: deps.maxTokens })
    .sink("compress-finalize", {
      orchestrator: deps.orchestrator,
      contextService: deps.contextService,
      persistence: deps.persistence,
    });
}
