import { describe, expect, mock, test } from "bun:test";
import { TaskState } from "@atom-neo/shared";
import { TaskQueue } from "../task-queue";
import { TaskSubmissionError, TaskSubmissionService } from "../task/task-submission-service";
import { createTaskHandler, taskCancelHandler } from "./tasks";

describe("task creation API", () => {
  test("returns the created task through the shared submission service", async () => {
    const queue = new TaskQueue();
    const service = new TaskSubmissionService({ taskQueue: queue });
    const response = await createTaskHandler(service, {
      sessionId: "s1",
      data: { text: "hello" },
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { taskId: string; state: string };
    expect(body.taskId).toMatch(/^task-/);
    expect(body.state).toBe("waiting");
    expect(queue.waiting).toBe(1);
    expect(queue.getStatus(body.taskId)).toEqual({ taskId: body.taskId, state: TaskState.WAITING });
  });

  test("maps invalid input to 400", async () => {
    const service = new TaskSubmissionService({ taskQueue: new TaskQueue() });
    const response = await createTaskHandler(service, {});

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid task submission payload", code: "INVALID_INPUT" });
  });

  test("maps checkpoint failures to 500", async () => {
    const service = {
      submit: () => { throw new TaskSubmissionError("PERSISTENCE_FAILED", "Failed to persist session message"); },
    } as unknown as TaskSubmissionService;
    const response = await createTaskHandler(service, { sessionId: "s1", data: { text: "hello" } });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to persist session message", code: "PERSISTENCE_FAILED" });
  });
});

describe("task cancellation API", () => {
  test("requires a session before cancelling a task chain", async () => {
    const cancel = mock(() => true);
    const response = taskCancelHandler(
      { cancel } as any,
      new Request("http://localhost/api/tasks/task-1", { method: "DELETE" }),
      "task-1",
    );

    expect(response.status).toBe(400);
    expect(cancel).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "sessionId is required" });
  });

  test("delegates cancellation to TaskEngine with the requested session", async () => {
    const cancel = mock(() => true);
    const response = taskCancelHandler(
      { cancel } as any,
      new Request("http://localhost/api/tasks/task-1?sessionId=session-1", { method: "DELETE" }),
      "task-1",
    );

    expect(cancel).toHaveBeenCalledWith("task-1", "session-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ taskId: "task-1", state: "cancelled" });
  });
});
