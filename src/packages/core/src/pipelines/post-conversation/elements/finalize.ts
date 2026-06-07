import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import { BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { PostConversationFlowState, AnalysisResult } from "./types";

const FALLBACK: AnalysisResult = { status: "satisfactory", reason: "fallback" };

export class PostConversationFinalizeElement extends BaseElement<PostConversationFlowState, PipelineResult> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
  }

  async doProcess(input: PostConversationFlowState): Promise<PipelineResult> {
    const { status, reason } = input.analysis ?? FALLBACK;

    this.report(BusEvents.Element.Data, { step: "decision", status, reason });

    if (status === "blocked") {
      input.session.postCheckGuidance = resolvePrompt(PromptKey.GUIDANCE_RETRY);
      this.report(BusEvents.Conversation.Chain, {
        sessionId: input.session.sessionId,
        chatId: input.task?.chatId ?? "",
        parentTaskId: input.task?.parentTaskId ?? input.task?.id ?? "",
        action: "post_check_retry",
      });
      return { type: "complete", task: input.task, output: `post-conversation: blocked, scheduling retry — ${reason}` };
    }

    return { type: "complete", task: input.task, output: `post-conversation: no action — ${status}: ${reason}` };
  }
}
