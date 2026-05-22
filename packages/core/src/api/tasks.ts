import type { TaskQueue } from "../task-queue";
import type { PipelineEventBus } from "@atom-neo/shared";
import type { CoreEventMap } from "@atom-neo/shared";
import { createTaskItem } from "../task-factory";
import { TaskSource } from "@atom-neo/shared";
import type { Pipeline } from "../pipeline/builder";

const pipelineMap = new Map<string, Pipeline>();

export function getPipeline(taskId: string): Pipeline | undefined {
  return pipelineMap.get(taskId);
}

export function removePipeline(taskId: string): void {
  pipelineMap.delete(taskId);
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
      pipeline: body.pipeline ?? "conversation",
      source: TaskSource.EXTERNAL,
      payload: [{ type: "text", data: body.data?.text ?? "" }],
    });

    if (pipeline) pipelineMap.set(task.id, pipeline);

    taskQueue.enqueue(task);
    if (bus) bus.emit("task.enqueued" as any, { task });

    return Response.json({ taskId: task.id, state: task.state }, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 400 });
  }
}

export function taskCancelHandler(taskQueue: TaskQueue, _req: Request, taskId: string): Response {
  if (taskQueue.remove(taskId)) {
    return Response.json({ taskId, state: "cancelled" });
  }
  return Response.json({ taskId, state: "not_found" }, { status: 404 });
}

