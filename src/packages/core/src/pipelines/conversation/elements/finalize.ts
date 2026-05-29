import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { TaskSource } from "@atom-neo/shared";
import { createTaskItem } from "../../../task-factory";
import type { TaskQueue } from "../../../task-queue";
import type { ConversationFlowState } from "./types";

const MAX_FOLLOW_UP_DEPTH = 5;

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

    if (!input.chainAction || !this.#buildChainPipeline || !this.#queue) {
      return {
        type: "complete" as const,
        task: input.task,
        output: input.responseText,
        reasoningContent: input.reasoningContent,
        tokenUsage: input.tokenUsage,
      };
    }

    if (input.chainAction === "more_tools") {
      return this.#createMoreToolsTask(input);
    }

    if (input.chainAction === "follow_up") {
      if (this.#chainDepth >= MAX_FOLLOW_UP_DEPTH) {
        return this.#createEvaluatorTask(input);
      }
      if (this.#chainDepth >= 3 && this.#chainDepth % 3 === 0) {
        return this.#createEvaluatorTask(input);
      }
      return this.#createFollowUpTask(input);
    }

    return {
      type: "complete" as const,
      task: input.task,
      output: input.responseText,
      reasoningContent: input.reasoningContent,
      tokenUsage: input.tokenUsage,
    };
  }

  #createMoreToolsTask(input: ConversationFlowState) {
    const chainTask = createTaskItem({
      sessionId: input.task.sessionId,
      chatId: input.task.chatId,
      pipeline: "conversation",
      source: TaskSource.INTERNAL,
      payload: [{ type: "text", data: "" }],
      parentTaskId: input.task.id,
      chainId: input.task.chainId,
    });
    this.#buildChainPipeline!(chainTask.id, input.task.sessionId, input.task.chatId, this.#chainDepth + 1);
    this.#queue.enqueue(chainTask);

    return {
      type: "complete" as const,
      task: input.task,
      output: input.responseText,
      reasoningContent: input.reasoningContent,
      tokenUsage: input.tokenUsage,
    };
  }

  #createFollowUpTask(input: ConversationFlowState) {
    const chainTask = createTaskItem({
      sessionId: input.task.sessionId,
      chatId: input.task.chatId,
      pipeline: "conversation",
      source: TaskSource.INTERNAL,
      payload: [{ type: "text", data: "请从上次中断处继续，不要重复已输出的内容。" }],
      parentTaskId: input.task.id,
      chainId: input.task.chainId,
    });
    this.#queue.enqueue(chainTask);

    return {
      type: "complete" as const,
      task: input.task,
      output: input.responseText,
      reasoningContent: input.reasoningContent,
      tokenUsage: input.tokenUsage,
    };
  }

  #createEvaluatorTask(input: ConversationFlowState) {
    const evalTask = createTaskItem({
      sessionId: input.task.sessionId,
      chatId: input.task.chatId,
      pipeline: "follow-up-evaluator",
      source: TaskSource.INTERNAL,
      parentTaskId: input.task.parentTaskId ?? input.task.id,
      payload: [],
    });
    this.#queue.enqueue(evalTask);

    return {
      type: "complete" as const,
      task: input.task,
      output: input.responseText,
      reasoningContent: input.reasoningContent,
      tokenUsage: input.tokenUsage,
    };
  }
}
