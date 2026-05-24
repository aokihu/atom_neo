import { describe, test, expect } from "bun:test";
import { TaskQueue } from "./task-queue";
import { TaskState, TaskSource } from "@atom-neo/shared";
import type { TaskItem } from "@atom-neo/shared";

function makeTask(id: string, source: TaskSource = TaskSource.EXTERNAL): TaskItem {
  return {
    id,
    chainId: id,
    parentTaskId: null,
    sessionId: "s1",
    chatId: "c1",
    source,
    pipeline: "test",
    priority: source === TaskSource.EXTERNAL ? 10 : 5,
    createdAt: Date.now(),
    payload: [],
    state: TaskState.WAITING,
    updatedAt: Date.now(),
  };
}

describe("TaskQueue", () => {
  test("EXTERNAL tasks enter WaitingQueue and dequeue FIFO", () => {
    const q = new TaskQueue();
    q.enqueue(makeTask("a", TaskSource.EXTERNAL));
    q.enqueue(makeTask("b", TaskSource.EXTERNAL));
    q.enqueue(makeTask("c", TaskSource.EXTERNAL));

    expect(q.waiting).toBe(3);
    expect(q.dequeue()!.id).toBe("a");
    expect(q.dequeue()!.id).toBe("b");
    expect(q.dequeue()!.id).toBe("c");
  });

  test("INTERNAL tasks enter ActiveQueue and dequeue LIFO", () => {
    const q = new TaskQueue();
    q.enqueue(makeTask("chain-1", TaskSource.INTERNAL));
    q.enqueue(makeTask("chain-2", TaskSource.INTERNAL));
    q.enqueue(makeTask("chain-3", TaskSource.INTERNAL));

    expect(q.active).toBe(3);
    expect(q.dequeue()!.id).toBe("chain-3"); // last in, first out
    expect(q.dequeue()!.id).toBe("chain-2");
    expect(q.dequeue()!.id).toBe("chain-1");
  });

  test("ActiveQueue drains before WaitingQueue", () => {
    const q = new TaskQueue();
    q.enqueue(makeTask("user-1", TaskSource.EXTERNAL));
    q.enqueue(makeTask("chain-1", TaskSource.INTERNAL));
    q.enqueue(makeTask("user-2", TaskSource.EXTERNAL));

    expect(q.dequeue()!.id).toBe("chain-1"); // INTERNAL first
    expect(q.dequeue()!.id).toBe("user-1");  // then FIFO from WaitingQueue
    expect(q.dequeue()!.id).toBe("user-2");
  });

  test("returns undefined when both queues are empty", () => {
    const q = new TaskQueue();
    expect(q.dequeue()).toBeUndefined();
  });

  test("tracks processing state", () => {
    const q = new TaskQueue();
    const task = makeTask("t1");
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

  test("removes task by id from either queue", () => {
    const q = new TaskQueue();
    q.enqueue(makeTask("ext-1", TaskSource.EXTERNAL));
    q.enqueue(makeTask("int-1", TaskSource.INTERNAL));

    expect(q.remove("ext-1")).toBe(true);
    expect(q.waiting).toBe(0);
    expect(q.remove("int-1")).toBe(true);
    expect(q.active).toBe(0);
    expect(q.remove("gone")).toBe(false);
  });

  test("reports correct counts across both queues", () => {
    const q = new TaskQueue();
    q.enqueue(makeTask("a", TaskSource.EXTERNAL));
    q.enqueue(makeTask("b", TaskSource.EXTERNAL));
    q.enqueue(makeTask("c", TaskSource.INTERNAL));
    expect(q.waiting).toBe(2);
    expect(q.active).toBe(1);
    expect(q.size).toBe(3);

    q.dequeue(); // takes INTERNAL "c" first
    q.markProcessing("c");
    expect(q.waiting).toBe(2);
    expect(q.active).toBe(0);
    expect(q.processing).toBe(1);
    expect(q.size).toBe(3);
  });
});
