import { BaseElement } from "@atom-neo/shared";
import { PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { ContextService } from "@atom-neo/core";
import type { ConversationFlowState } from "./types";

const PLATFORM_PROMPTS: Record<string, PromptKey> = {
  telegram: PromptKey.TELEGRAM_STYLE,
};

export class ApplySourceContextElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #contextService: ContextService;

  constructor(params: { contextService: ContextService; name?: string; kind?: string; bus?: any }) {
    super({ name: params.name ?? "apply-source-context", kind: "transform", bus: params.bus as any });
    this.#contextService = params.contextService;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    const platform = (input.task as any)?.platform as string | undefined;
    if (!platform) return input;

    const key = PLATFORM_PROMPTS[platform];
    if (!key) return input;

    const instructions = resolvePrompt(key);
    if (!instructions) return input;

    this.#contextService.put({
      scope: "task",
      entry: {
        key: "source-style",
        source: "prompt-registry",
        channel: "instructions",
        trust: "trusted",
        priority: 800,
        pinned: false,
        content: instructions,
      },
    });

    return input;
  }
}
