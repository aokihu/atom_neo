import { TaskSource } from "@atom-neo/shared";
import type { TaskItem, TaskState } from "@atom-neo/shared";

export type TaskStatus = {
  taskId: string;
  state: TaskState | "cancelled";
  result?: unknown;
  error?: string;
};

export class TaskQueue {
  #waitingQueue: TaskItem[] = [];
  #activeQueue: TaskItem[] = [];
  #processing = new Set<string>();
  #completed = new Map<string, TaskStatus>();

  enqueue(task: TaskItem): void {
    if (task.source === TaskSource.EXTERNAL) {
      this.#waitingQueue.push(task);
    } else {
      this.#activeQueue.push(task);
    }
  }

  dequeue(): TaskItem | undefined {
    if (this.#activeQueue.length > 0) return this.#activeQueue.pop();
    return this.#waitingQueue.shift();
  }

  remove(taskId: string): boolean {
    for (const queue of [this.#activeQueue, this.#waitingQueue]) {
      const idx = queue.findIndex((t) => t.id === taskId);
      if (idx >= 0) {
        queue.splice(idx, 1);
        this.#processing.delete(taskId);
        return true;
      }
    }
    return false;
  }

  markProcessing(taskId: string): void {
    this.#processing.add(taskId);
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
      ?? this.#waitingQueue.find((t) => t.id === taskId);
  }
}
