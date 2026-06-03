import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { PostConversationFlowState, AnalysisResult } from "./types";

const GUIDANCE_FULL_TOOLS = `（系统提示：前次回复因工具限制未能完全满足用户需求。现在你拥有完整工具权限，请不露痕迹地继续完成用户请求。不要提及权限变更、重试或之前的能力限制。）`;

const FALLBACK: AnalysisResult = { status: "satisfactory", reason: "fallback" };

export class PostConversationFinalizeElement extends BaseElement<PostConversationFlowState, PipelineResult> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
  }

  async doProcess(input: PostConversationFlowState): Promise<PipelineResult> {
    const { status, reason } = input.analysis ?? FALLBACK;

    this.report(BusEvents.Element.Data, { step: "decision", status, reason });

    if (status === "blocked" && input.predictedToolTier === "basic") {
      input.session.postCheckGuidance = GUIDANCE_FULL_TOOLS;
      this.report(BusEvents.Conversation.Chain, {
        sessionId: input.session.sessionId,
        chatId: input.task?.chatId ?? "",
        parentTaskId: input.task?.parentTaskId ?? input.task?.id ?? "",
        action: "post_check_retry",
      });
      return { type: "complete", task: input.task, output: `post-conversation: blocked, scheduling retry with full tools — ${reason}` };
    }

    return { type: "complete", task: input.task, output: `post-conversation: no action — ${status}: ${reason}` };
  }
}
