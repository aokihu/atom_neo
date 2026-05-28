import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { TaskSource } from "@atom-neo/shared";
import { createTaskItem } from "../../../task-factory";
import type { TaskQueue } from "../../../task-queue";
import type { ConversationFlowState } from "./types";

export class FinalizeElement extends BaseElement<ConversationFlowState, any> {
  #queue: TaskQueue;
  #buildChainPipeline: ((taskId: string, sessionId: string, chatId: string, chainDepth: number) => void) | undefined;
  #chainDepth: number;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    queue?: TaskQueue;
    buildChainPipeline?: (taskId: string, sessionId: string, chatId: string, chainDepth: number) => void;
    chainDepth?: number;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#queue = params.queue as TaskQueue;
    this.#buildChainPipeline = params.buildChainPipeline;
    this.#chainDepth = params.chainDepth ?? 0;
  }

  async doProcess(input: ConversationFlowState): Promise<any> {
    if (input.mode !== "ready_to_finalize") {
      throw new Error("FinalizeElement: expected ready_to_finalize");
    }

    const MAX_FOLLOW_UP_DEPTH = 5;

    if (input.chainAction && this.#chainDepth >= MAX_FOLLOW_UP_DEPTH) {
      return {
        type: "complete" as const,
        task: input.task,
        output: (input.responseText ?? "") + "\n\n(已达到最大连续对话深度，操作已停止)",
        reasoningContent: input.reasoningContent,
        tokenUsage: input.tokenUsage,
      };
    }

    if (input.chainAction && this.#buildChainPipeline && this.#queue) {
      const payload: Array<{ type: "text"; data: string }> =
        input.chainAction === "follow_up"
          ? [{ type: "text", data: "请从上次中断处继续，不要重复已输出的内容。" }]
          : [{ type: "text", data: "" }];

      const chainTask = createTaskItem({
        sessionId: input.task.sessionId,
        chatId: input.task.chatId,
        pipeline: "conversation",
        source: TaskSource.INTERNAL,
        payload,
        parentTaskId: input.task.id,
        chainId: input.task.chainId,
      });

      if (input.chainAction === "more_tools") {
        this.#buildChainPipeline(chainTask.id, input.task.sessionId, input.task.chatId, this.#chainDepth + 1);
      }
      this.#queue.enqueue(chainTask);
    }

    return {
      type: "complete" as const,
      task: input.task,
      output: input.responseText,
      reasoningContent: input.reasoningContent,
      tokenUsage: input.tokenUsage,
    };
  }
}
