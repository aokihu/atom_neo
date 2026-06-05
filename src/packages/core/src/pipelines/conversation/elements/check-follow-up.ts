import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { IntentRequestType } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";

export class CheckFollowUpElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #memory: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    memory?: any;
  }) {
    super({ name: params.name, kind: "boundary", bus: params.bus });
    this.#memory = params.memory;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "executing") return input;

    const intents = input.intents ?? [];

    for (const intent of intents) {
      if (intent.request === IntentRequestType.KEEP_MEMORY && this.#memory) {
        const memId = intent.params.id as string;
        if (memId && this.#memory.has?.(memId)) {
          this.#memory.keep(memId);
        }
      }
    }

    for (const intent of intents) {
      if (intent.request === IntentRequestType.FOLLOW_UP) {
        const p = intent.params as Record<string, string>;
        this.report(BusEvents.Element.Data, { step: "done", chainAction: "follow_up" });
        return {
          ...input,
          mode: "ready_to_finalize",
          chainAction: "follow_up",
          followUp: {
            summary: p.summary ?? "follow_up",
            nextPrompt: p.next_prompt ?? "",
            avoidRepeat: p.avoid_repeat ?? "",
          },
        };
      }
    }

    this.report(BusEvents.Element.Data, { step: "done", chainAction: "none" });
    return { ...input, mode: "ready_to_finalize" };
  }
}
