import type { TaskQueue, TaskStatus } from "../task-queue";
import type { PipelineEventBus } from "@atom-neo/shared";
import type { CoreEventMap } from "@atom-neo/shared";
import { TaskSource, TaskState, BusEvents } from "@atom-neo/shared";
import { createTaskItem } from "../task-factory";
import type { Pipeline } from "../pipeline/builder";
import type { TaskEngine } from "../task-engine";

const pipelineMap = new Map<string, Pipeline>();

export function getPipeline(taskId: string): Pipeline | undefined {
  return pipelineMap.get(taskId);
}

export function removePipeline(taskId: string): void {
  pipelineMap.delete(taskId);
}

export function setPipeline(taskId: string, pipeline: Pipeline): void {
  pipelineMap.set(taskId, pipeline);
}

export async function createTaskHandler(
  taskQueue: TaskQueue,
  body: any,
  bus?: PipelineEventBus<CoreEventMap>,
  pipeline?: Pipeline,
): Promise<Response> {
  try {
    const task = createTaskItem({
      sessionId: body.sessionId,
      chatId: body.chatId,
      pipeline: body.pipeline ?? "prediction",
      source: TaskSource.EXTERNAL,
      payload: [{ type: "text", data: body.data?.text ?? "" }],
    });

    if (pipeline) pipelineMap.set(task.id, pipeline);

    taskQueue.enqueue(task);
    if (bus) bus.emit(BusEvents.Task.Enqueued as any, { task });

    return Response.json({ taskId: task.id, state: task.state }, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 400 });
  }
}

export function taskCancelHandler(taskEngine: TaskEngine, req: Request, taskId: string): Response {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) return Response.json({ error: "sessionId is required" }, { status: 400 });
  if (taskEngine.cancel(taskId, sessionId)) {
    return Response.json({ taskId, state: TaskState.CANCELLED });
  }
  return Response.json({ taskId, state: "not_found" }, { status: 404 });
}

export function taskStatusHandler(taskQueue: TaskQueue, taskId: string): Response {
  const status = taskQueue.getStatus(taskId);
  if (!status) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(status);
}
