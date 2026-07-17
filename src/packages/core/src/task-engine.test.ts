import { describe, expect, test } from "bun:test";
import { BusEvents, PipelineEventBus, TaskSource, TaskState } from "@atom-neo/shared";
import type { FullEventMap, TaskItem } from "@atom-neo/shared";
import { TaskEngine } from "./task-engine";
import { TaskQueue } from "./task-queue";

const createTask = (id: string): TaskItem => ({
  id,
  chainId: id,
  parentTaskId: null,
  sessionId: "session",
  chatId: "chat",
  source: TaskSource.EXTERNAL,
  pipeline: "missing",
  priority: 10,
  createdAt: Date.now(),
  payload: [],
  state: TaskState.WAITING,
  updatedAt: Date.now(),
});

describe("TaskEngine", () => {
  test("drains queued and processing tasks before stopping", async () => {
    const bus = new PipelineEventBus<FullEventMap>();
    const queue = new TaskQueue();
    const completed: string[] = [];
    bus.on(BusEvents.Task.Completed, ({ task }) => completed.push(task.id));
    queue.enqueue(createTask("first"));
    queue.enqueue(createTask("second"));
    const engine = new TaskEngine({ bus, queue });
    engine.start();

    expect(await engine.drain({ timeoutMs: 1_000 })).toBe(true);
    expect(queue.size).toBe(0);
    expect(completed).toEqual(["first", "second"]);
  });

  test("processes tasks serially when several enqueue events arrive together", async () => {
    const bus = new PipelineEventBus<FullEventMap>();
    const queue = new TaskQueue();
    let processing = 0;
    let maxProcessing = 0;
    const engine = new TaskEngine({
      bus,
      queue,
      pipelineBuilders: {
        test: () => ({
          elements: [{
            process: async (input: unknown) => {
              processing++;
              maxProcessing = Math.max(maxProcessing, processing);
              await new Promise(resolve => setTimeout(resolve, 5));
              processing--;
              return input;
            },
          }],
        } as any),
      },
    });
    engine.start();
    for (const id of ["first", "second", "third"]) {
      const task = { ...createTask(id), pipeline: "test" };
      queue.enqueue(task);
      bus.emit(BusEvents.Task.Enqueued, { task });
    }

    expect(await engine.drain({ timeoutMs: 1_000 })).toBe(true);
    expect(maxProcessing).toBe(1);
  });

  test("cancels a running task only from its owning session", async () => {
    const bus = new PipelineEventBus<FullEventMap>();
    const queue = new TaskQueue();
    const task = { ...createTask("running"), pipeline: "blocking" };
    let activated = false;
    let failedTask: TaskItem | undefined;
    bus.on(BusEvents.Task.Activated, () => { activated = true; });
    bus.on(BusEvents.Task.Failed, ({ task: failed }) => { failedTask = failed; });
    const engine = new TaskEngine({
      bus,
      queue,
      pipelineBuilders: {
        blocking: () => ({
          elements: [{
            process: async (input: { abortSignal: AbortSignal }) => {
              await new Promise<void>((_resolve, reject) => {
                input.abortSignal.addEventListener("abort", () => reject(input.abortSignal.reason), { once: true });
              });
              return input;
            },
          }],
        } as any),
      },
    });
    queue.enqueue(task);
    engine.start();
    bus.emit(BusEvents.Task.Enqueued, { task });
    while (!activated) await new Promise(resolve => setTimeout(resolve, 0));

    expect(engine.cancel(task.id, "other-session")).toBe(false);
    expect(engine.cancel(task.id, task.sessionId)).toBe(true);
    expect(await engine.drain({ timeoutMs: 1_000 })).toBe(true);
    expect(failedTask?.state).toBe(TaskState.CANCELLED);
    expect(queue.size).toBe(0);
  });

  test("cancels a queued task before normal execution", () => {
    const bus = new PipelineEventBus<FullEventMap>();
    const queue = new TaskQueue();
    const task = createTask("queued");
    let failedTask: TaskItem | undefined;
    bus.on(BusEvents.Task.Failed, ({ task: failed }) => { failedTask = failed; });
    const engine = new TaskEngine({ bus, queue });
    queue.enqueue(task);

    expect(engine.cancel(task.id, task.sessionId)).toBe(true);
    expect(failedTask?.state).toBe(TaskState.CANCELLED);
    expect(queue.getStatus(task.id)?.state).toBe(TaskState.CANCELLED);
    expect(queue.size).toBe(0);
  });

  test("cancels the running task and every queued member in the same chain", async () => {
    const bus = new PipelineEventBus<FullEventMap>();
    const queue = new TaskQueue();
    const running = { ...createTask("running"), chainId: "chain", pipeline: "blocking" };
    const queued = { ...createTask("queued"), chainId: "chain" };
    const unrelated = { ...createTask("unrelated"), chainId: "other" };
    const failed: string[] = [];
    const completed: string[] = [];
    let activated = false;
    const discarded: string[] = [];
    bus.on(BusEvents.Task.Activated, ({ task }) => {
      if (task.id === running.id) activated = true;
    });
    bus.on(BusEvents.Task.Failed, ({ task }) => failed.push(task.id));
    bus.on(BusEvents.Task.Completed, ({ task }) => completed.push(task.id));
    const engine = new TaskEngine({
      bus,
      queue,
      discardChain: (chainId, sessionId) => discarded.push(`${sessionId}:${chainId}`),
      pipelineBuilders: {
        blocking: () => ({
          elements: [{
            process: async (input: { abortSignal: AbortSignal }) => {
              await new Promise<void>((_resolve, reject) => {
                input.abortSignal.addEventListener("abort", () => reject(input.abortSignal.reason), { once: true });
              });
              return input;
            },
          }],
        } as any),
      },
    });

    queue.enqueue(running);
    engine.start();
    bus.emit(BusEvents.Task.Enqueued, { task: running });
    while (!activated) await new Promise(resolve => setTimeout(resolve, 0));
    queue.enqueue(queued);
    queue.enqueue(unrelated);

    expect(engine.cancel(queued.id, queued.sessionId)).toBe(true);
    expect(await engine.drain({ timeoutMs: 1_000 })).toBe(true);
    expect(failed.sort()).toEqual(["queued", "running"]);
    expect(queue.getStatus(queued.id)?.state).toBe(TaskState.CANCELLED);
    expect(discarded).toEqual(["session:chain"]);
    expect(completed).toEqual(["unrelated"]);
  });
});
