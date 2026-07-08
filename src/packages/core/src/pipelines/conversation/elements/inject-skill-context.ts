import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";
import type { SkillServiceLike } from "../../../skills/types";

export class InjectSkillContextElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #skillService: SkillServiceLike;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    skillService: SkillServiceLike;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#skillService = params.skillService;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    const skillContext = this.#skillService.buildContext();
    return { ...input, skillContext };
  }
}
