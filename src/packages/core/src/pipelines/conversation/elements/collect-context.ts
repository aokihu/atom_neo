import { BaseElement, BusEvents } from "@atom-neo/shared";
import type { PipelineEventBus, PipelineEventMap } from "@atom-neo/shared";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MAX_TOKENS } from "../../../constants";
import type { ContextService } from "../../../context/context-service";
import type { ConversationFlowState } from "./types";

const CONTEXT_RESERVE = 4096;

export class CollectContextElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #contextService: ContextService;
  #inputBudget: number;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    contextService: ContextService;
    configContextLimit?: number;
    maxTokens?: number;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#contextService = params.contextService;
    this.#inputBudget = Math.max(
      1,
      (params.configContextLimit ?? DEFAULT_CONTEXT_LIMIT)
        - (params.maxTokens ?? DEFAULT_MAX_TOKENS)
        - CONTEXT_RESERVE,
    );
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "context_recorded") return input;

    const contextSnapshot = this.#contextService.createSnapshot({
      ...input.contextOwner,
      inputBudget: this.#inputBudget,
    });
    const state = this.#contextService.inspectSnapshot(contextSnapshot.id)!;
    this.report(BusEvents.Element.Data, {
      step: "snapshot-created",
      snapshotId: contextSnapshot.id,
      estimatedTokens: state.estimatedTokens,
      inputBudget: state.inputBudget,
      prefixHash: state.prefixHash,
      manifest: state.manifest,
    });
    return { ...input, mode: "formatted", contextSnapshot };
  }
}
