import { describe, test, expect } from "bun:test";
import { TaskQueue } from "./task-queue";
import { TaskState, TaskSource } from "@atom-neo/shared";
import type { TaskItem } from "@atom-neo/shared";

function makeTask(id: string, priority: number): TaskItem {
  return {
    id,
    chainId: id,
    parentTaskId: null,
    sessionId: "s1",
    chatId: "c1",
    source: TaskSource.EXTERNAL,
    pipeline: "test",
    priority,
    createdAt: Date.now(),
    payload: [],
    state: TaskState.WAITING,
    updatedAt: Date.now(),
  };
}

describe("TaskQueue", () => {
  test("dequeues tasks in priority order", () => {
    const q = new TaskQueue();
    q.enqueue(makeTask("low", 1));
    q.enqueue(makeTask("high", 10));
    q.enqueue(makeTask("mid", 5));

    expect(q.dequeue()!.id).toBe("high");
    expect(q.dequeue()!.id).toBe("mid");
    expect(q.dequeue()!.id).toBe("low");
  });

  test("returns undefined when queue is empty", () => {
    const q = new TaskQueue();
    expect(q.dequeue()).toBeUndefined();
  });

  test("tracks processing state", () => {
    const q = new TaskQueue();
    const task = makeTask("t1", 5);
    q.enqueue(task);
    q.dequeue();
    q.markProcessing("t1");

    expect(q.isProcessing("t1")).toBe(true);
    expect(q.processing).toBe(1);
    expect(q.waiting).toBe(0);

    q.markDone("t1");
    expect(q.isProcessing("t1")).toBe(false);
    expect(q.processing).toBe(0);
  });

  test("removes task by id from queue", () => {
    const q = new TaskQueue();
    q.enqueue(makeTask("t1", 5));
    q.enqueue(makeTask("t2", 3));

    expect(q.remove("t1")).toBe(true);
    expect(q.waiting).toBe(1);
    expect(q.remove("gone")).toBe(false);
  });

  test("reports correct size and waiting count", () => {
    const q = new TaskQueue();
    q.enqueue(makeTask("a", 5));
    q.enqueue(makeTask("b", 3));
    expect(q.waiting).toBe(2);
    expect(q.size).toBe(2);

    q.dequeue();
    q.markProcessing("a");
    expect(q.waiting).toBe(1);
    expect(q.processing).toBe(1);
    expect(q.size).toBe(2);
  });
});
