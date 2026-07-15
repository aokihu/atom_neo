import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { IntentRequestType } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import { hasActiveTodos } from "../../../session/context";
import type { ConversationFlowState } from "./types";

export class CheckFollowUpElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #memory: any;
  #session: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    memory?: any;
    session?: any;
  }) {
    super({ name: params.name, kind: "boundary", bus: params.bus });
    this.#memory = params.memory;
    this.#session = params.session;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "executing") return input;

    const intents = input.intents ?? [];
    const nonRecoverableError = (input.errorStatusCode ?? 0) >= 400;

    for (const intent of intents) {
      if (intent.request === IntentRequestType.RETAIN_MEMORY && this.#memory) {
        const memId = typeof intent.params.id === "string" ? intent.params.id : "";
        if (!memId) continue;
        const fullMemoryId = this.#memory.findFullId?.(memId) ?? (this.#memory.has?.(memId) ? memId : null);
        if (fullMemoryId) {
          this.#memory.retain(fullMemoryId);
        }
      }
    }

    if (nonRecoverableError) {
      this.report(BusEvents.Element.Data, { step: "done", chainAction: "none", reason: "non_recoverable_error" });
      return { ...input, mode: "ready_to_finalize", chainAction: undefined };
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

    const activeTodos = hasActiveTodos(this.#session?.todoState);
    const chainAction = input.chainAction ?? (activeTodos ? "continue_todo" : undefined);
    this.report(BusEvents.Element.Data, {
      step: "done",
      chainAction: chainAction ?? "none",
      reason: input.chainAction ? "stream" : activeTodos ? "active_todos" : "complete",
    });
    return { ...input, mode: "ready_to_finalize", chainAction };
  }
}
