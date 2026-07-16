import { describe, test, expect } from "bun:test";
import { TaskQueue } from "./task-queue";
import { TaskPriority, TaskState, TaskSource } from "@atom-neo/shared";
import type { TaskItem } from "@atom-neo/shared";

function makeTask(
  id: string,
  source: TaskSource = TaskSource.EXTERNAL,
  priority: number = source === TaskSource.EXTERNAL ? TaskPriority.EXTERNAL : TaskPriority.INTERNAL,
): TaskItem {
  return {
    id,
    chainId: id,
    parentTaskId: null,
    sessionId: "s1",
    chatId: "c1",
    source,
    pipeline: "test",
    priority,
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
    q.markProcessing(task);

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

    expect(q.remove("ext-1")?.id).toBe("ext-1");
    expect(q.waiting).toBe(0);
    expect(q.remove("int-1")?.id).toBe("int-1");
    expect(q.active).toBe(0);
    expect(q.remove("gone")).toBeUndefined();
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
    q.markProcessing(makeTask("c", TaskSource.INTERNAL));
    expect(q.waiting).toBe(2);
    expect(q.active).toBe(0);
    expect(q.processing).toBe(1);
    expect(q.size).toBe(3);
  });

  test("dequeues the highest priority task before queue source order", () => {
    const q = new TaskQueue();
    q.enqueue(makeTask("external-high", TaskSource.EXTERNAL, 80));
    q.enqueue(makeTask("internal-default", TaskSource.INTERNAL));
    q.enqueue(makeTask("external-default", TaskSource.EXTERNAL));

    expect(q.dequeue()?.id).toBe("external-high");
    expect(q.dequeue()?.id).toBe("internal-default");
    expect(q.dequeue()?.id).toBe("external-default");
  });

  test("cancels every queued and processing member of the matching task chain", () => {
    const q = new TaskQueue();
    const root = { ...makeTask("root"), chainId: "chain" };
    const child = { ...makeTask("child", TaskSource.INTERNAL), chainId: "chain" };
    const processing = { ...makeTask("processing"), chainId: "chain" };
    const unrelated = { ...makeTask("unrelated"), chainId: "other" };
    q.enqueue(root);
    q.enqueue(child);
    q.enqueue(unrelated);
    q.markProcessing(processing);

    expect(q.cancelChain("child", "other-session")).toBeUndefined();
    const cancelled = q.cancelChain("child", "s1");

    expect(cancelled?.chainId).toBe("chain");
    expect(cancelled?.queued.map(task => task.id).sort()).toEqual(["child", "root"]);
    expect(cancelled?.processing).toEqual([processing]);
    expect(q.waiting).toBe(1);
    expect(q.active).toBe(0);
    expect(q.processing).toBe(1);
    expect(q.dequeue()?.id).toBe("unrelated");
  });

  test("uses a completed root task ID to cancel remaining chain members", () => {
    const q = new TaskQueue();
    const root = { ...makeTask("root"), chainId: "chain" };
    const postConversation = {
      ...makeTask("post-conversation", TaskSource.INTERNAL),
      chainId: "chain",
      parentTaskId: root.id,
    };

    q.enqueue(root);
    q.dequeue();
    q.markProcessing(root);
    q.markDone(root.id);
    q.enqueue(postConversation);

    const cancelled = q.cancelChain(root.id, root.sessionId);
    expect(cancelled?.queued).toEqual([postConversation]);
    expect(q.active).toBe(0);
  });
});
