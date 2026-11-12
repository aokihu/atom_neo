import type { TaskQueue } from "../task-queue";
import { TaskState, errorMessage } from "@atom-neo/shared";
import type { SessionInitiator } from "@atom-neo/shared";
import type { TaskEngine } from "../task-engine";
import { TaskSubmissionError, type TaskSubmissionService } from "../task/task-submission-service";

export type TaskRequestBody = {
  sessionId?: string;
  chatId?: string;
  pipeline?: string;
  initiator?: SessionInitiator;
  platform?: string;
  data?: { text?: string };
};

export async function createTaskHandler(
  taskSubmission: TaskSubmissionService,
  body: TaskRequestBody,
): Promise<Response> {
  try {
    const task = taskSubmission.submit({
      sessionId: body.sessionId ?? "",
      chatId: body.chatId,
      pipeline: body.pipeline,
      text: body.data?.text,
      initiator: body.initiator,
      platform: body.platform,
    });
    return Response.json({ taskId: task.id, state: task.state }, { status: 201 });
  } catch (error) {
    if (error instanceof TaskSubmissionError) {
      const status = error.code === "INVALID_INPUT" ? 400 : 500;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    return Response.json({ error: errorMessage(error) }, { status: 500 });
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
