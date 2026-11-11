import { describe, expect, mock, test } from "bun:test";
import { BusEvents, PipelineEventBus, TaskState } from "@atom-neo/shared";
import type { FullEventMap, TaskItem } from "@atom-neo/shared";
import { SessionStore } from "../session/store";
import { TaskQueue } from "../task-queue";
import { TaskSubmissionError, TaskSubmissionService } from "./task-submission-service";

function createStore(checkpoint: () => void = () => {}) {
  return new SessionStore(10, undefined, 0, {
    restore: () => null,
    checkpoint,
    remove: () => {},
  } as never);
}

describe("TaskSubmissionService", () => {
  test("defaults to prediction and enqueues once", () => {
    const queue = new TaskQueue();
    const bus = new PipelineEventBus<FullEventMap>();
    const store = createStore();
    let enqueued: TaskItem | undefined;
    bus.on(BusEvents.Task.Enqueued, ({ task }) => { enqueued = task; });
    const service = new TaskSubmissionService({ taskQueue: queue, bus, sessionStore: store });

    const task = service.submit({ sessionId: "s1", text: "hello" });

    expect(task.pipeline).toBe("prediction");
    expect(task.chatId).toBe("default");
    expect(task.state).toBe(TaskState.WAITING);
    expect(queue.waiting).toBe(1);
    expect(enqueued?.id).toBe(task.id);
    expect(store.get("s1").messages[0]?.content).toBe("hello");
  });

  test("honors chatId, pipeline, platform, and initiator", () => {
    const queue = new TaskQueue();
    const service = new TaskSubmissionService({ taskQueue: queue });

    const task = service.submit({
      sessionId: "s1",
      chatId: "chat",
      pipeline: "conversation",
      platform: "tui",
      initiator: { type: "tui" },
      text: "go",
    });

    expect(task.chatId).toBe("chat");
    expect(task.pipeline).toBe("conversation");
    expect(task.platform).toBe("tui");
  });

  test("checkpoints the user text exactly once", () => {
    const queue = new TaskQueue();
    const checkpoint = mock(() => {});
    const service = new TaskSubmissionService({ taskQueue: queue, sessionStore: createStore(checkpoint) });

    service.submit({ sessionId: "s1", text: "persist me" });

    expect(checkpoint).toHaveBeenCalledTimes(1);
  });

  test("does not checkpoint when text is empty", () => {
    const checkpoint = mock(() => {});
    const service = new TaskSubmissionService({ taskQueue: new TaskQueue(), sessionStore: createStore(checkpoint) });

    service.submit({ sessionId: "s1" });

    expect(checkpoint).not.toHaveBeenCalled();
  });

  test("surfaces checkpoint failures and does not enqueue", () => {
    const queue = new TaskQueue();
    const store = createStore(() => { throw new Error("disk full"); });
    const service = new TaskSubmissionService({ taskQueue: queue, sessionStore: store });

    let error: unknown;
    try {
      service.submit({ sessionId: "s1", text: "persist me" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TaskSubmissionError);
    expect((error as TaskSubmissionError).code).toBe("PERSISTENCE_FAILED");
    expect((error as TaskSubmissionError).message).toBe("Failed to persist session message");
    expect(queue.waiting).toBe(0);
    expect(store.get("s1").messages).toHaveLength(0);
  });

  test("preserves SUSPEND when releaseTask does not queue the task", () => {
    const queue = new TaskQueue();
    const bus = new PipelineEventBus<FullEventMap>();
    let enqueued = false;
    bus.on(BusEvents.Task.Enqueued, () => { enqueued = true; });
    const releaseTask = mock(() => false);
    const service = new TaskSubmissionService({ taskQueue: queue, bus, releaseTask });

    const task = service.submit({ sessionId: "s1", text: "wait" });

    expect(releaseTask).toHaveBeenCalledTimes(1);
    expect(task.state).toBe(TaskState.SUSPEND);
    expect(queue.getStatus(task.id)).toEqual({ taskId: task.id, state: TaskState.SUSPEND });
    expect(queue.waiting).toBe(0);
    expect(enqueued).toBe(false);
  });

  test("keeps the released task state when releaseTask queues it", () => {
    const queue = new TaskQueue();
    const service = new TaskSubmissionService({
      taskQueue: queue,
      releaseTask: task => { queue.enqueue(task); return true; },
    });

    const task = service.submit({ sessionId: "s1", text: "go" });

    expect(task.state).toBe(TaskState.WAITING);
    expect(queue.getStatus(task.id)).toEqual({ taskId: task.id, state: TaskState.WAITING });
  });

  test("rejects invalid input with a stable code", () => {
    const service = new TaskSubmissionService({ taskQueue: new TaskQueue() });

    for (const input of [
      {},
      { sessionId: "" },
      { sessionId: "s1", pipeline: "" },
      { sessionId: "s1", text: 42 },
    ]) {
      let error: unknown;
      try {
        service.submit(input as never);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(TaskSubmissionError);
      expect((error as TaskSubmissionError).code).toBe("INVALID_INPUT");
    }
  });
});
