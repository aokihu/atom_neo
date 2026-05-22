import { describe, test, expect } from "bun:test";
import { createTaskItem, createContinuationTask } from "./task-factory";
import { TaskSource, TaskState } from "@atom-neo/shared";

describe("createTaskItem", () => {
  test("creates task with external source and waiting state", () => {
    const task = createTaskItem({
      sessionId: "s1",
      chatId: "c1",
      pipeline: "conversation",
      source: TaskSource.EXTERNAL,
      payload: [{ type: "text", data: "hello" }],
    });

    expect(task.id).toMatch(/^task-/);
    expect(task.sessionId).toBe("s1");
    expect(task.state).toBe(TaskState.WAITING);
    expect(task.source).toBe(TaskSource.EXTERNAL);
    expect(task.pipeline).toBe("conversation");
    expect(task.parentTaskId).toBeNull();
    expect(task.chainId).toBe(task.id);
    expect(task.priority).toBeGreaterThan(0);
  });

  test("assigns higher priority to external tasks", () => {
    const ext = createTaskItem({
      sessionId: "s1", chatId: "c1", pipeline: "test",
      source: TaskSource.EXTERNAL, payload: [],
    });
    const int = createTaskItem({
      sessionId: "s1", chatId: "c1", pipeline: "test",
      source: TaskSource.INTERNAL, payload: [],
    });

    expect(ext.priority).toBeGreaterThan(int.priority);
  });
});

describe("createContinuationTask", () => {
  test("creates continuation from parent task", () => {
    const parent = createTaskItem({
      sessionId: "s1", chatId: "c1", pipeline: "conv",
      source: TaskSource.EXTERNAL, payload: [],
    });

    const child = createContinuationTask({
      parentTask: parent,
      pipeline: "follow-up",
      payload: [{ type: "text", data: "follow up" }],
    });

    expect(child.parentTaskId).toBe(parent.id);
    expect(child.chainId).toBe(parent.chainId);
    expect(child.sessionId).toBe(parent.sessionId);
    expect(child.source).toBe(TaskSource.INTERNAL);
  });
});
