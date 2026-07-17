import { describe, expect, mock, test } from "bun:test";
import { taskCancelHandler } from "./tasks";

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
