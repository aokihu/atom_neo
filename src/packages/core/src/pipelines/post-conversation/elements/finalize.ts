import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import { BusEvents, PromptKey, resolvePrompt } from "@atom-neo/shared";
import type { PostConversationFlowState } from "./types";
import { FALLBACK_ANALYSIS, STALL_THRESHOLD } from "./types";
import { trigramSimilarity } from "../../shared/trigram";

export class PostConversationFinalizeElement extends BaseElement<PostConversationFlowState, PipelineResult> {
  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap> }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
  }

  async doProcess(input: PostConversationFlowState): Promise<PipelineResult> {
    const { status, reason, fingerprint } = input.analysis ?? FALLBACK_ANALYSIS;

    this.report(BusEvents.Element.Data, { step: "decision", status, reason, fingerprint });

    if (status === "needs_user_input") {
      return { type: "complete", task: input.task, output: `post-conversation: waiting for user — ${reason}` };
    }

    if (status === "blocked") {
      if (input.session?.originalSource === "external") {
        return { type: "complete", task: input.task, output: `post-conversation: blocked, awaiting user judgment — ${reason}` };
      }

      const fp = fingerprint?.slice(0, 50) ?? "";
      if (fp) {
        const prev = input.session?.postCheckFingerprints ?? ([] as string[]);
        let maxSim = 0;
        for (const p of prev) {
          const sim = trigramSimilarity(fp, p);
          if (sim > maxSim) maxSim = sim;
        }
        if (maxSim > STALL_THRESHOLD) {
          this.report(BusEvents.Element.Data, { step: "stalled", maxSimilarity: +maxSim.toFixed(3), threshold: STALL_THRESHOLD, fingerprint: fp, prevCount: prev.length });
          return { type: "complete", task: input.task, output: `post-conversation: stalled — ${+maxSim.toFixed(2)}% similar to previous (reason: ${reason})` };
        }
        input.session.addPostCheckFingerprint(fp);
      }

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
