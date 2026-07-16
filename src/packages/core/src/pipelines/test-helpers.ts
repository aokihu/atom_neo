import { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../task/internal-task-orchestrator";

export function makeBus() {
  return new PipelineEventBus<FullEventMap>();
}

export function makeMockOrchestrator(capture: { enqueued: any } | null) {
  return {
    scheduleConversation: (_sid: string, _cid: string, _ptid: string, payload?: any[]) => {
      if (capture) capture.enqueued = { pipeline: "conversation", parentTaskId: _ptid, payload };
    },
    scheduleEvaluator: () => {},
    scheduleCompress: () => {},
    scheduleFollowUp: () => {},
  } as unknown as InternalTaskOrchestrator;
}
