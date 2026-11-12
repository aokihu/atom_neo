import { PipelineEventBus, createPromptRegistry, createPromptResolver } from "@atom-neo/shared";
import type { FullEventMap, PromptResolver } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../task/internal-task-orchestrator";

export function makeBus() {
  return new PipelineEventBus<FullEventMap>();
}

/** Explicit prompt resolver for tests that construct pipeline elements directly. */
export function makePromptResolver(): PromptResolver {
  return createPromptResolver(createPromptRegistry());
}

export function makeMockOrchestrator(capture: { enqueued: any } | null) {
  return {
    scheduleConversation: (_sid: string, _cid: string, _ptid: string, payload?: any[]) => {
      if (capture) capture.enqueued = { pipeline: "conversation", parentTaskId: _ptid, payload };
    },
    scheduleContinuation: (_sid: string, _cid: string, _ptid: string, _owner?: string, continuation?: any) => {
      if (capture) capture.enqueued = { pipeline: "conversation", parentTaskId: _ptid, continuation };
    },
    scheduleEvaluator: () => {},
    scheduleCompress: () => {},
    scheduleFollowUp: () => {},
  } as unknown as InternalTaskOrchestrator;
}
