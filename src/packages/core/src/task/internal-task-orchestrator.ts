import { createTaskItem } from "../task-factory";
import { TaskSource } from "@atom-neo/shared";
import type { TaskPayload } from "@atom-neo/shared";
import type { TaskQueue } from "../task-queue";

export class InternalTaskOrchestrator {
  #queue: TaskQueue;

  constructor(queue: TaskQueue) {
    this.#queue = queue;
  }

  scheduleConversation(
    sessionId: string,
    chatId: string,
    parentTaskId: string,
    payload?: TaskPayload[],
    onEnqueue?: (task: { id: string }) => void,
  ): void {
    const task = createTaskItem({
      sessionId,
      chatId,
      pipeline: "conversation",
      source: TaskSource.INTERNAL,
      parentTaskId,
      payload: payload ?? [],
    });
    if (onEnqueue) onEnqueue(task);
    this.#queue.enqueue(task);
  }

  scheduleEvaluator(
    sessionId: string,
    chatId: string,
    parentTaskId: string,
  ): void {
    const task = createTaskItem({
      sessionId,
      chatId,
      pipeline: "follow-up-evaluator",
      source: TaskSource.INTERNAL,
      parentTaskId,
      payload: [],
    });
    this.#queue.enqueue(task);
  }

  scheduleCompress(
    sessionId: string,
    chatId: string,
    parentTaskId: string,
  ): void {
    const task = createTaskItem({
      sessionId,
      chatId,
      pipeline: "context-compress",
      source: TaskSource.INTERNAL,
      parentTaskId,
      payload: [],
    });
    this.#queue.enqueue(task);
  }

  scheduleFollowUp(
    sessionId: string,
    chatId: string,
    parentTaskId: string,
  ): void {
    const task = createTaskItem({
      sessionId,
      chatId,
      pipeline: "conversation",
      source: TaskSource.INTERNAL,
      parentTaskId,
      payload: [{ type: "text", data: "请从上次中断处继续，不要重复已输出的内容。" }],
    });
    this.#queue.enqueue(task);
  }
}
