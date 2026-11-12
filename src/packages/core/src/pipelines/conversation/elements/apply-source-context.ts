import { BaseElement } from "@atom-neo/shared";
import { PromptKey } from "@atom-neo/shared";
import type { PromptResolver } from "@atom-neo/shared";
import type { ContextService } from "@atom-neo/core";
import type { ConversationFlowState } from "./types";

const PLATFORM_PROMPTS: Record<string, PromptKey> = {
  telegram: PromptKey.TELEGRAM_STYLE,
};

export class ApplySourceContextElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #contextService: ContextService;
  #promptResolver: PromptResolver;
  #providerModel: string;

  constructor(params: {
    contextService: ContextService;
    promptResolver: PromptResolver;
    providerModel?: string;
    name?: string;
    kind?: string;
    bus?: any;
  }) {
    super({ name: params.name ?? "apply-source-context", kind: "transform", bus: params.bus as any });
    this.#contextService = params.contextService;
    this.#promptResolver = params.promptResolver;
    this.#providerModel = params.providerModel ?? "deepseek/deepseek-v4-pro";
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    const platform = (input.task as any)?.platform as string | undefined;
    if (!platform) return input;

    const key = PLATFORM_PROMPTS[platform];
    if (!key) return input;

    const instructions = this.#promptResolver(key, this.#providerModel);
    if (!instructions) return input;

    this.#contextService.put({
      scope: "task",
      owner: input.contextOwner,
      entry: {
        key: "source-style",
        source: "prompt-registry",
        channel: "instructions",
        format: "text",
        trust: "trusted",
        priority: 800,
        pinned: false,
        content: instructions,
      },
    });

    return input;
  }
}
