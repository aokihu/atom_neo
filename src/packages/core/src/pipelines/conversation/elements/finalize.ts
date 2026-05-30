import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { ConversationFlowState } from "./types";

const MAX_FOLLOW_UP_DEPTH = 5;

export class FinalizeElement extends BaseElement<ConversationFlowState, any> {
  #orchestrator: InternalTaskOrchestrator;
  #chainDepth: number;
  #buildChainPipeline: ((taskId: string, sessionId: string, chatId: string, chainDepth: number) => void) | undefined;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
    buildChainPipeline?: (taskId: string, sessionId: string, chatId: string, chainDepth: number) => void;
    chainDepth?: number;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#buildChainPipeline = params.buildChainPipeline;
    this.#chainDepth = params.chainDepth ?? 0;
  }

  async doProcess(input: ConversationFlowState): Promise<any> {
    if (input.mode !== "ready_to_finalize") {
      throw new Error("FinalizeElement: expected ready_to_finalize");
    }

    if (!input.chainAction || !this.#buildChainPipeline) {
      return this.#complete(input);
    }

    if (input.chainAction === "more_tools") {
      this.#orchestrator.scheduleConversation(
        input.task.sessionId,
        input.task.chatId,
        input.task.id,
        [{ type: "text", data: "" }],
        (task) => {
          this.#buildChainPipeline!(task.id, input.task.sessionId, input.task.chatId, this.#chainDepth + 1);
        },
      );
      return this.#complete(input);
    }

    if (input.chainAction === "follow_up") {
      if (this.#chainDepth >= MAX_FOLLOW_UP_DEPTH) {
        this.#orchestrator.scheduleEvaluator(input.task.sessionId, input.task.chatId, input.task.parentTaskId ?? input.task.id);
        return this.#complete(input);
      }
      if (this.#chainDepth >= 3 && this.#chainDepth % 3 === 0) {
        this.#orchestrator.scheduleEvaluator(input.task.sessionId, input.task.chatId, input.task.parentTaskId ?? input.task.id);
        return this.#complete(input);
      }
      this.#orchestrator.scheduleFollowUp(input.task.sessionId, input.task.chatId, input.task.id);
      return this.#complete(input);
    }

    return this.#complete(input);
  }

  #complete(input: ConversationFlowState) {
    return {
      type: "complete" as const,
      task: input.task,
      output: input.responseText,
      reasoningContent: input.reasoningContent,
      tokenUsage: input.tokenUsage,
    };
  }
}
