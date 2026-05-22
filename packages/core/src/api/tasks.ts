import type { TaskQueue } from "../task-queue";
import { createTaskItem } from "../task-factory";
import { TaskSource } from "@atom-neo/shared";

export function taskSubmitHandler(taskQueue: TaskQueue, _req: Request): Response {
  return new Response(null, { status: 201 });
}

export async function createTaskHandler(taskQueue: TaskQueue, req: Request): Promise<Response> {
  try {
    const body: any = await req.json();
    const task = createTaskItem({
      sessionId: body.sessionId,
      chatId: body.chatId,
      pipeline: body.pipeline ?? "conversation",
      source: TaskSource.EXTERNAL,
      payload: [{ type: "text", data: body.data?.text ?? "" }],
    });

    taskQueue.enqueue(task);
    return Response.json({ taskId: task.id, state: task.state }, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 400 });
  }
}

export function taskStatusHandler(taskQueue: TaskQueue, _req: Request, taskId: string): Response {
  // Look through queue for task
  const tasks = taskQueue as any;
  return Response.json({ taskId, state: "not_found" }, { status: 404 });
}

export function taskCancelHandler(taskQueue: TaskQueue, _req: Request, taskId: string): Response {
  if (taskQueue.remove(taskId)) {
    return Response.json({ taskId, state: "cancelled" });
  }
  return Response.json({ taskId, state: "not_found" }, { status: 404 });
}
