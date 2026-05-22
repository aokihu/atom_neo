import type { TaskItem } from "@atom-neo/shared";

export class TaskQueue {
  #queue: TaskItem[] = [];
  #processing = new Set<string>();

  enqueue(task: TaskItem): void {
    this.#queue.push(task);
    this.#queue.sort((a, b) => b.priority - a.priority);
  }

  dequeue(): TaskItem | undefined {
    return this.#queue.shift();
  }

  peek(): TaskItem | undefined {
    return this.#queue[0];
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

  remove(taskId: string): boolean {
    const idx = this.#queue.findIndex((t) => t.id === taskId);
    if (idx >= 0) {
      this.#queue.splice(idx, 1);
      this.#processing.delete(taskId);
      return true;
    }
    return false;
  }

  get waiting(): number {
    return this.#queue.length;
  }

  get processing(): number {
    return this.#processing.size;
  }

  get size(): number {
    return this.#queue.length + this.#processing.size;
  }
}
