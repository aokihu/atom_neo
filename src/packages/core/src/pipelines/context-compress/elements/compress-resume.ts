import type { ContextCompressRequest, ContinuationDecision } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { ElementTask } from "../../../session/element-session";

export type CompressResumeParams = {
  request: ContextCompressRequest;
  sessionId: string;
  task: ElementTask;
  report: (payload: Record<string, unknown>) => void;
  orchestrator: InternalTaskOrchestrator;
};

export type CompressResumeResult = { chainAction: "follow_up"; continuationDecision: ContinuationDecision };

/** Apply the resume decision after a committed compression checkpoint. */
export function resumeAfterCompress(params: CompressResumeParams): CompressResumeResult | undefined {
  const { request, sessionId, task, report, orchestrator } = params;
  report({ step: "conversation resume scheduled", trigger: request.trigger, sessionId, parentTaskId: task.parentTaskId });

  if (request.resumeTask) {
    orchestrator.releaseTask(request.resumeTask, task.id);
  } else if (request.continuation && request.trigger === "token-overflow") {
    // Core grants the recovery slot only after this compression checkpoint commits.
    return { chainAction: "follow_up", continuationDecision: request.continuation };
  } else if (request.continuation) {
    orchestrator.scheduleContinuation(sessionId, task.chatId ?? "chat",
      task.parentTaskId ?? task.id, task.id, request.continuation);
  } else {
    orchestrator.scheduleConversation(sessionId, task.chatId ?? "chat",
      task.parentTaskId ?? task.id,
      [{ type: "text", data: "请根据对话摘要和最近消息，从被截断处继续；不要重复已经完成的内容。" }],
      undefined, task.id);
  }
  return undefined;
}
