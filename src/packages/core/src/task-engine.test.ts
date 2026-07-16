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
});
