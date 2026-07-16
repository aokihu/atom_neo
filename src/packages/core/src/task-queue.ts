import { TaskSource } from "@atom-neo/shared";
import type { TaskItem, TaskState } from "@atom-neo/shared";

export type TaskStatus = {
  taskId: string;
  state: TaskState;
  result?: unknown;
  error?: string;
};

export type TaskChainCancellation = {
  chainId: string;
  queued: TaskItem[];
  processing: TaskItem[];
};

export class TaskQueue {
  #waitingQueue: TaskItem[] = [];
  #activeQueue: TaskItem[] = [];
  #processing = new Map<string, TaskItem>();
  #completed = new Map<string, TaskStatus>();
  #taskIdentity = new Map<string, Pick<TaskItem, "chainId" | "sessionId">>();

  enqueue(task: TaskItem): void {
    this.#taskIdentity.set(task.id, task);
    if (task.source === TaskSource.EXTERNAL) {
      this.#waitingQueue.push(task);
    } else {
      this.#activeQueue.push(task);
    }
  }

  dequeue(): TaskItem | undefined {
    const activeIndex = this.#highestPriorityIndex(this.#activeQueue, true);
    const waitingIndex = this.#highestPriorityIndex(this.#waitingQueue, false);
    if (activeIndex < 0) return waitingIndex < 0 ? undefined : this.#waitingQueue.splice(waitingIndex, 1)[0];
    if (waitingIndex < 0) return this.#activeQueue.splice(activeIndex, 1)[0];

    const active = this.#activeQueue[activeIndex];
    const waiting = this.#waitingQueue[waitingIndex];
    return active.priority >= waiting.priority
      ? this.#activeQueue.splice(activeIndex, 1)[0]
      : this.#waitingQueue.splice(waitingIndex, 1)[0];
  }

  remove(taskId: string): TaskItem | undefined {
    for (const queue of [this.#activeQueue, this.#waitingQueue]) {
      const idx = queue.findIndex((t) => t.id === taskId);
      if (idx >= 0) {
        return queue.splice(idx, 1)[0];
      }
    }
    return undefined;
  }

  cancelChain(taskId: string, sessionId: string): TaskChainCancellation | undefined {
    const target = this.#findInQueues(taskId) ?? this.#taskIdentity.get(taskId);
    if (!target || target.sessionId !== sessionId) return undefined;

    const chainId = target.chainId;
    const matches = (task: TaskItem) => task.sessionId === sessionId && task.chainId === chainId;
    const queued = [
      ...this.#activeQueue.filter(matches),
      ...this.#waitingQueue.filter(matches),
    ];
    this.#activeQueue = this.#activeQueue.filter(task => !matches(task));
    this.#waitingQueue = this.#waitingQueue.filter(task => !matches(task));

    const processing = [...this.#processing.values()].filter(matches);
    if (queued.length === 0 && processing.length === 0) return undefined;

    return {
      chainId,
      queued,
      processing,
    };
  }

  markProcessing(task: TaskItem): void {
    this.#taskIdentity.set(task.id, task);
    this.#processing.set(task.id, task);
  }

  markDone(taskId: string): void {
    this.#processing.delete(taskId);
  }

  isProcessing(taskId: string): boolean {
    return this.#processing.has(taskId);
  }

  get waiting(): number {
    return this.#waitingQueue.length;
  }

  get active(): number {
    return this.#activeQueue.length;
  }

  get processing(): number {
    return this.#processing.size;
  }

  get size(): number {
    return this.#waitingQueue.length + this.#activeQueue.length + this.#processing.size;
  }

  storeResult(taskId: string, status: TaskStatus): void {
    this.#completed.set(taskId, status);
  }

  getStatus(taskId: string): TaskStatus | undefined {
    const task = this.#findInQueues(taskId);
    if (task) return { taskId: task.id, state: task.state };
    return this.#completed.get(taskId);
  }

  #findInQueues(taskId: string): TaskItem | undefined {
    return this.#activeQueue.find((t) => t.id === taskId)
      ?? this.#waitingQueue.find((t) => t.id === taskId)
      ?? this.#processing.get(taskId);
  }

  #highestPriorityIndex(queue: TaskItem[], preferLatest: boolean): number {
    let selected = -1;
    for (let i = 0; i < queue.length; i++) {
      if (selected < 0 || queue[i].priority > queue[selected].priority
        || (preferLatest && queue[i].priority === queue[selected].priority)) {
        selected = i;
      }
    }
    return selected;
  }
}
