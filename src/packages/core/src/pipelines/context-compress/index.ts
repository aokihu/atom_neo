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
import type { PromptResolver, ProviderProtocol } from "@atom-neo/shared";
import { CONTEXT_RESERVE, DEFAULT_CONTEXT_LIMIT, DEFAULT_MAX_TOKENS } from "../../constants";

export function registerContextCompressElements(): void {
  registerElement("compress-input", CompressInputElement);
  registerElement("compress-archive", CompressArchiveElement);
  registerElement("compress-summarize", CompressSummarizeElement);
  registerElement("compress-finalize", CompressFinalizeElement);
}

export function contextCompressPipeline(deps: {
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
      promptResolver: deps.promptResolver,
      apiKey: deps.apiKey,
      model: deps.model,
      provider: deps.provider,
      protocol: deps.protocol,
      baseUrl: deps.baseUrl,
      thinking: deps.thinking,
      options: deps.options,
    })
    .boundary("token-ratio", { session: deps.session, configContextLimit: deps.configContextLimit, maxTokens: deps.maxTokens })
    .sink("compress-finalize", {
      orchestrator: deps.orchestrator,
      contextService: deps.contextService,
      persistence: deps.persistence,
      workspaceId: deps.sandbox,
      inputBudget: Math.max(
        1,
        (deps.configContextLimit ?? DEFAULT_CONTEXT_LIMIT)
          - (deps.maxTokens ?? DEFAULT_MAX_TOKENS)
          - CONTEXT_RESERVE,
      ),
    });
}
