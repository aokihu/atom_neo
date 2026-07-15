import { createTaskItem } from "../task-factory";
import { TaskSource, BusEvents } from "@atom-neo/shared";
import type { TaskPayload, PipelineEventBus, FullEventMap } from "@atom-neo/shared";
import type { TaskQueue } from "../task-queue";

export class InternalTaskOrchestrator {
  #queue: TaskQueue;
  #bus?: PipelineEventBus<FullEventMap>;

  constructor(queue: TaskQueue, bus?: PipelineEventBus<FullEventMap>) {
    this.#queue = queue;
    this.#bus = bus;
  }

  scheduleConversation(
    sessionId: string,
    chatId: string,
    parentTaskId: string,
    payload?: TaskPayload[],
    onEnqueue?: (task: { id: string }) => void,
  ): void {
    this.#schedule("conversation", { sessionId, chatId, parentTaskId, payload, onEnqueue });
  }

  scheduleEvaluator(sessionId: string, chatId: string, parentTaskId: string): void {
    this.#schedule("follow-up-evaluator", { sessionId, chatId, parentTaskId });
  }

  scheduleCompress(sessionId: string, chatId: string, parentTaskId: string): void {
    this.#schedule("context-compress", { sessionId, chatId, parentTaskId });
  }

  scheduleFollowUp(sessionId: string, chatId: string, parentTaskId: string): void {
    this.#schedule("conversation", {
      sessionId, chatId, parentTaskId,
      payload: [{ type: "text", data: "请从上次中断处继续，不要重复已输出的内容。" }],
    });
  }

  scheduleTodoContinuation(sessionId: string, chatId: string, parentTaskId: string): void {
    this.#schedule("conversation", {
      sessionId, chatId, parentTaskId,
      payload: [{ type: "text", data: "请继续执行当前 TODO；完成后更新 TODO 状态，再处理下一项。" }],
    });
  }

  schedulePostConversation(sessionId: string, chatId: string, parentTaskId: string): void {
    this.#schedule("post-conversation", { sessionId, chatId, parentTaskId });
  }

  #schedule(pipeline: string, opts: {
    sessionId: string;
    chatId: string;
    parentTaskId: string;
    payload?: TaskPayload[];
    onEnqueue?: (task: { id: string }) => void;
  }): void {
    const task = createTaskItem({
      sessionId: opts.sessionId,
      chatId: opts.chatId,
      pipeline,
      source: TaskSource.INTERNAL,
      parentTaskId: opts.parentTaskId,
      payload: opts.payload ?? [],
    });
    opts.onEnqueue?.(task);
    this.#queue.enqueue(task);
    this.#bus?.emit(BusEvents.Task.Enqueued as any, { task });
  }
}
