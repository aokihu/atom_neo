import { TaskSource } from "@atom-neo/shared";
import type { TaskItem } from "@atom-neo/shared";

export class TaskQueue {
  #waitingQueue: TaskItem[] = [];
  #activeQueue: TaskItem[] = [];
  #processing = new Set<string>();

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
}
