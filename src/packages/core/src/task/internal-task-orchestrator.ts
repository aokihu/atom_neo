import { createTaskItem } from "../task-factory";
import { TaskSource, BusEvents } from "@atom-neo/shared";
import type { ContinuationDecision, ContextCompressRequest, TaskItem, TaskOrigin, TaskPayload, PipelineEventBus, FullEventMap } from "@atom-neo/shared";
import type { TaskQueue } from "../task-queue";

type StagedTask = { task: TaskItem; onEnqueue?: (task: { id: string }) => void };

export class InternalTaskOrchestrator {
  #queue: TaskQueue;
  #prepareRelease?: (task: TaskItem) => TaskItem | undefined;
  #bus?: PipelineEventBus<FullEventMap>;
  #stagedTasks = new Map<string, StagedTask[]>();
  #taskOrigins = new Map<string, TaskOrigin>();
  #taskChains = new Map<string, string>();
  #taskSessions = new Map<string, string>();

  constructor(queue: TaskQueue, bus?: PipelineEventBus<FullEventMap>) {
    this.#queue = queue;
    this.#bus = bus;
  }

  setReleaseGuard(prepareRelease: (task: TaskItem) => TaskItem | undefined): void {
    this.#prepareRelease = prepareRelease;
  }

  releaseTask(task: TaskItem, ownerTaskId?: string): boolean {
    if (ownerTaskId) {
      const staged = this.#stagedTasks.get(ownerTaskId);
      if (!staged) throw new Error(`Task owner is not active: ${ownerTaskId}`);
      staged.push({ task });
      return false;
    }
    return this.#enqueue({ task });
  }

  beginTask(task: TaskItem): void {
    if (!this.#stagedTasks.has(task.id)) this.#stagedTasks.set(task.id, []);
    if (task.origin) this.#taskOrigins.set(task.id, task.origin);
    this.#taskChains.set(task.id, task.chainId ?? task.id);
    this.#taskSessions.set(task.id, task.sessionId);
  }

  commitTask(taskId: string): boolean {
    const staged = this.#stagedTasks.get(taskId);
    if (!staged) return false;
    this.#stagedTasks.delete(taskId);
    this.#taskOrigins.delete(taskId);
    this.#taskChains.delete(taskId);
    this.#taskSessions.delete(taskId);
    let released = false;
    let conversationReleased = false;
    for (const item of staged) {
      if (item.task.pipeline === "conversation" && conversationReleased) continue;
      const queued = this.#enqueue(item);
      if (item.task.pipeline === "conversation" && queued) conversationReleased = true;
      released = queued || released;
    }
    return released;
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

  scheduleEvaluator(sessionId: string, chatId: string, parentTaskId: string, ownerTaskId?: string, continuation?: ContinuationDecision): void {
    this.#schedule("follow-up-evaluator", { sessionId, chatId, parentTaskId, ownerTaskId,
      payload: continuation ? [{ type: "continuation_request", data: continuation }] : [] });
  }

  scheduleCompress(
    sessionId: string,
    chatId: string,
    parentTaskId: string,
    request: ContextCompressRequest,
    ownerTaskId?: string,
  ): void {
    this.#schedule("context-compress", {
      sessionId,
      chatId,
      parentTaskId,
      payload: [{ type: "context_compress_request", data: request }],
      ownerTaskId,
    });
  }

  scheduleFollowUp(sessionId: string, chatId: string, parentTaskId: string, ownerTaskId?: string, continuation?: ContinuationDecision): void {
    this.scheduleContinuation(sessionId, chatId, parentTaskId, ownerTaskId, continuation,
      "请从上次中断处继续，不要重复已输出的内容。");
  }

  scheduleTodoContinuation(sessionId: string, chatId: string, parentTaskId: string, ownerTaskId?: string, continuation?: ContinuationDecision): void {
    this.scheduleContinuation(sessionId, chatId, parentTaskId, ownerTaskId, continuation,
      "请继续执行当前 TODO；完成后更新 TODO 状态，再处理下一项。");
  }

  scheduleContinuation(sessionId: string, chatId: string, parentTaskId: string, ownerTaskId?: string, continuation?: ContinuationDecision, fallbackPrompt?: string): void {
    const prompts = {
      resume_current: "请从上次中断处继续当前内容，不重复正文，不跳过当前任务。",
      advance_todo: "请执行所选的剩余 TODO，保留已完成内容；当前项完成后更新 TODO 并结束本轮。",
      reconcile_progress: "请根据已经保存的正文核对 TODO，只调用 todowrite 更新进度，不重新输出正文。",
      finish: "",
    };
    const prompt = continuation ? prompts[continuation.kind] : fallbackPrompt ?? prompts.resume_current;
    const target = continuation?.target ? `\n本轮唯一目标（任务描述）：${JSON.stringify(continuation.target.content)}。只处理这个目标，不重写已完成项。` : "";
    const payload: TaskPayload[] = [{ type: "text", data: prompt + target }];
    if (continuation) payload.push({ type: "continuation_request", data: continuation });
    this.scheduleConversation(sessionId, chatId, parentTaskId, payload, undefined, ownerTaskId);
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
    this.#bus?.emit(BusEvents.Element.Data as any, { name: "orchestrator", payload: {
      step: staged ? "task-staged" : "task-requested", sessionId: task.sessionId, taskId: task.id,
      parentTaskId: task.parentTaskId, rootTaskId: task.chainId, requestedByTaskId: opts.ownerTaskId ?? opts.parentTaskId,
      pipeline, continuation: task.payload.find(part => part.type === "continuation_request")?.data
        ?? task.payload.find(part => part.type === "context_compress_request")?.data.continuation,
    } });
    if (staged) {
      staged.push(item);
      return;
    }
    this.#enqueue(item);
  }

  #enqueue(item: StagedTask): boolean {
    const task = this.#prepareRelease ? this.#prepareRelease(item.task) : item.task;
    if (!task) return false;
    if (task === item.task) item.onEnqueue?.(task);
    this.#queue.enqueue(task);
    this.#bus?.emit(BusEvents.Task.Enqueued as any, { task });
    return true;
  }
}
