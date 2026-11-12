import { describe, expect, test } from "bun:test";
import { TaskSource, TaskState } from "@atom-neo/shared";
import type { TaskItem } from "@atom-neo/shared";
import { PipelineInstanceStore } from "../pipeline/instance-store";
import { TaskCancelledError, TaskRunner } from "./task-runner";

const createTask = (id = "task"): TaskItem => ({
  id,
  chainId: id,
  parentTaskId: null,
  sessionId: "session",
  chatId: "chat",
  source: TaskSource.EXTERNAL,
  pipeline: "test",
  priority: 10,
  createdAt: Date.now(),
  payload: [],
  state: TaskState.WAITING,
  updatedAt: Date.now(),
});

const pipelineOf = (...elements: Array<{ process: (input: any) => Promise<any> }>) => ({
  name: "test",
  elements,
}) as any;

describe("TaskRunner", () => {
  test("returns complete when no pipeline is registered", async () => {
    const task = { ...createTask(), pipeline: "missing" };
    const store = new PipelineInstanceStore();
    const runner = new TaskRunner({ pipelineStore: store });

    const result = await runner.run(task, new AbortController().signal);

    expect(result).toEqual({ type: "complete", task });
    expect(store.size).toBe(0);
  });

  test("executes elements in order with a new state object per element", async () => {
    const task = createTask();
    const store = new PipelineInstanceStore();
    const controller = new AbortController();
    const received: any[] = [];
    const firstState = { mode: "first", task };
    const pipeline = pipelineOf(
      {
        process: async (input: any) => {
          received.push(input);
          expect(input.mode).toBe("initial");
          expect(input.task).toBe(task);
          expect(input.abortSignal).toBe(controller.signal);
          return firstState;
        },
      },
      {
        process: async (input: any) => {
          received.push(input);
          expect(input).not.toBe(firstState);
          expect(firstState).not.toHaveProperty("abortSignal");
          return { ...input, mode: "second" };
        },
      },
    );
    const runner = new TaskRunner({
      pipelineStore: store,
      pipelineBuilders: { test: () => pipeline },
    });

    const result = await runner.run(task, controller.signal);

    expect(received).toHaveLength(2);
    expect(received[0]).not.toBe(received[1]);
    expect(firstState).not.toHaveProperty("abortSignal");
    expect(result).toMatchObject({ mode: "second" });
    expect(result).not.toHaveProperty("abortSignal");
    expect(store.get(task.id)).toBe(pipeline);
  });

  test("builds a pipeline once per task id", async () => {
    const task = createTask();
    const store = new PipelineInstanceStore();
    let builds = 0;
    const runner = new TaskRunner({
      pipelineStore: store,
      pipelineBuilders: {
        test: () => {
          builds++;
          return pipelineOf({ process: async (input: any) => input });
        },
      },
    });

    await runner.run(task, new AbortController().signal);
    await runner.run(task, new AbortController().signal);

    expect(builds).toBe(1);
  });

  test("propagates element errors", async () => {
    const task = createTask();
    const runner = new TaskRunner({
      pipelineStore: new PipelineInstanceStore(),
      pipelineBuilders: {
        test: () => pipelineOf({ process: async () => { throw new Error("boom"); } }),
      },
    });

    await expect(runner.run(task, new AbortController().signal)).rejects.toThrow("boom");
  });

  test("throws TaskCancelledError for an already-aborted signal", async () => {
    const task = createTask();
    const controller = new AbortController();
    controller.abort(new TaskCancelledError());
    let called = false;
    const runner = new TaskRunner({
      pipelineStore: new PipelineInstanceStore(),
      pipelineBuilders: {
        test: () => pipelineOf({ process: async (input: any) => { called = true; return input; } }),
      },
    });

    await expect(runner.run(task, controller.signal)).rejects.toBeInstanceOf(TaskCancelledError);
    expect(called).toBe(false);
  });

  test("stops between elements when cancelled", async () => {
    const task = createTask();
    const controller = new AbortController();
    let secondCalled = false;
    const runner = new TaskRunner({
      pipelineStore: new PipelineInstanceStore(),
      pipelineBuilders: {
        test: () => pipelineOf(
          { process: async (input: any) => { controller.abort(new TaskCancelledError()); return input; } },
          { process: async (input: any) => { secondCalled = true; return input; } },
        ),
      },
    });

    await expect(runner.run(task, controller.signal)).rejects.toBeInstanceOf(TaskCancelledError);
    expect(secondCalled).toBe(false);
  });
});
