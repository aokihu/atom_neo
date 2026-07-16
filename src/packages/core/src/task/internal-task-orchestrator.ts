import { createTaskItem } from "../task-factory";
import { TaskSource, BusEvents } from "@atom-neo/shared";
import type { TaskItem, TaskOrigin, TaskPayload, PipelineEventBus, FullEventMap } from "@atom-neo/shared";
import type { TaskQueue } from "../task-queue";

type StagedTask = { task: TaskItem; onEnqueue?: (task: { id: string }) => void };

export class InternalTaskOrchestrator {
  #queue: TaskQueue;
  #bus?: PipelineEventBus<FullEventMap>;
  #stagedTasks = new Map<string, StagedTask[]>();
  #taskOrigins = new Map<string, TaskOrigin>();
  #taskChains = new Map<string, string>();
  #taskSessions = new Map<string, string>();

  constructor(queue: TaskQueue, bus?: PipelineEventBus<FullEventMap>) {
    this.#queue = queue;
    this.#bus = bus;
  }

  beginTask(task: TaskItem): void {
    if (!this.#stagedTasks.has(task.id)) this.#stagedTasks.set(task.id, []);
    if (task.origin) this.#taskOrigins.set(task.id, task.origin);
    this.#taskChains.set(task.id, task.chainId ?? task.id);
    this.#taskSessions.set(task.id, task.sessionId);
  }

  commitTask(taskId: string): void {
    const staged = this.#stagedTasks.get(taskId);
    if (!staged) return;
    this.#stagedTasks.delete(taskId);
    this.#taskOrigins.delete(taskId);
    this.#taskChains.delete(taskId);
    this.#taskSessions.delete(taskId);
    for (const item of staged) this.#enqueue(item);
  }

  discardTask(taskId: string): void {
    this.#stagedTasks.delete(taskId);
    this.#taskOrigins.delete(taskId);
    this.#taskChains.delete(taskId);
    this.#taskSessions.delete(taskId);
  }

  discardChain(chainId: string, sessionId: string): void {
    for (const [taskId, taskChainId] of this.#taskChains) {
      if (taskChainId === chainId && this.#taskSessions.get(taskId) === sessionId) {
        this.discardTask(taskId);
      }
    }
  }

  scheduleConversation(
    sessionId: string,
    chatId: string,
    parentTaskId: string,
    payload?: TaskPayload[],
    onEnqueue?: (task: { id: string }) => void,
    ownerTaskId?: string,
  ): void {
    this.#schedule("conversation", { sessionId, chatId, parentTaskId, payload, onEnqueue, ownerTaskId });
  }

  scheduleEvaluator(sessionId: string, chatId: string, parentTaskId: string, ownerTaskId?: string): void {
    this.#schedule("follow-up-evaluator", { sessionId, chatId, parentTaskId, ownerTaskId });
  }

  scheduleCompress(sessionId: string, chatId: string, parentTaskId: string, payload?: TaskPayload[], ownerTaskId?: string): void {
    this.#schedule("context-compress", { sessionId, chatId, parentTaskId, payload, ownerTaskId });
  }

  scheduleFollowUp(sessionId: string, chatId: string, parentTaskId: string, ownerTaskId?: string): void {
    this.#schedule("conversation", {
      sessionId, chatId, parentTaskId, ownerTaskId,
      payload: [{ type: "text", data: "请从上次中断处继续，不要重复已输出的内容。" }],
    });
  }

  scheduleTodoContinuation(sessionId: string, chatId: string, parentTaskId: string, ownerTaskId?: string): void {
    this.#schedule("conversation", {
      sessionId, chatId, parentTaskId, ownerTaskId,
      payload: [{ type: "text", data: "请继续执行当前 TODO；完成后更新 TODO 状态，再处理下一项。" }],
    });
  }

  schedulePostConversation(sessionId: string, chatId: string, parentTaskId: string, ownerTaskId?: string): void {
    this.#schedule("post-conversation", { sessionId, chatId, parentTaskId, ownerTaskId });
  }

  #schedule(pipeline: string, opts: {
    sessionId: string;
    chatId: string;
    parentTaskId: string;
    payload?: TaskPayload[];
    onEnqueue?: (task: { id: string }) => void;
    ownerTaskId?: string;
  }): void {
    const hasOwner = opts.ownerTaskId !== undefined;
    const staged = hasOwner ? this.#stagedTasks.get(opts.ownerTaskId!) : undefined;
    if (hasOwner && !staged) throw new Error(`Task owner is not active: ${opts.ownerTaskId}`);
    const task = createTaskItem({
      sessionId: opts.sessionId,
      chatId: opts.chatId,
      pipeline,
      source: TaskSource.INTERNAL,
      parentTaskId: opts.parentTaskId,
      payload: opts.payload ?? [],
      origin: hasOwner ? this.#taskOrigins.get(opts.ownerTaskId!) : undefined,
      chainId: hasOwner ? this.#taskChains.get(opts.ownerTaskId!) : undefined,
    });
    const item = { task, onEnqueue: opts.onEnqueue };
    if (staged) {
      staged.push(item);
      return;
    }
    this.#enqueue(item);
  }

  #enqueue(item: StagedTask): void {
    item.onEnqueue?.(item.task);
    this.#queue.enqueue(item.task);
    this.#bus?.emit(BusEvents.Task.Enqueued as any, { task: item.task });
  }
}
