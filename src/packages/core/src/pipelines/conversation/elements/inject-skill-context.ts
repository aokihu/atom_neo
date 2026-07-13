import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import type { ConversationFlowState } from "./types";
import type { SkillServiceLike } from "../../../skills/types";

export class InjectSkillContextElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #skillService: SkillServiceLike;
  #sessionId: string;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    skillService: SkillServiceLike;
    sessionId?: string;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#skillService = params.skillService;
    this.#sessionId = params.sessionId ?? "default";
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "streaming") return input;
    const skillContext = this.#skillService.buildContext(this.#sessionId);
    const skillContextRevision = this.#skillService.getRevision?.(this.#sessionId) ?? 0;
    return { ...input, skillContext, skillContextRevision };
  }
}
