import { TaskPriority, TaskSource, TaskState } from "@atom-neo/shared";
import type { TaskItem, TaskOrigin, TaskPayload } from "@atom-neo/shared";

let nextId = 0;

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${nextId++}`;
}

export function createTaskItem(params: {
  sessionId: string;
  chatId: string;
  pipeline: string;
  source: TaskSource;
  payload: TaskPayload[];
  parentTaskId?: string | null;
  chainId?: string;
  platform?: string;
  origin?: TaskOrigin;
}): TaskItem {
  const id = generateId("task");
  const chainId = params.chainId ?? id;
  const now = Date.now();

  return {
    id,
    chainId,
    parentTaskId: params.parentTaskId ?? id,
    sessionId: params.sessionId,
    chatId: params.chatId,
    source: params.source,
    pipeline: params.pipeline,
    priority: params.source === TaskSource.EXTERNAL
      ? TaskPriority.EXTERNAL
      : TaskPriority.INTERNAL,
    createdAt: now,
    payload: params.payload,
    ...(params.platform ? { platform: params.platform } : {}),
    ...(params.origin ? { origin: params.origin } : {}),
    state: TaskState.WAITING,
    updatedAt: now,
  };
}

export function createContinuationTask(params: {
  parentTask: TaskItem;
  payload: TaskPayload[];
  pipeline: string;
}): TaskItem {
  return createTaskItem({
    sessionId: params.parentTask.sessionId,
    chatId: params.parentTask.chatId,
    pipeline: params.pipeline,
    source: TaskSource.INTERNAL,
    payload: params.payload,
    parentTaskId: params.parentTask.id,
    chainId: params.parentTask.chainId,
    origin: params.parentTask.origin,
  });
}
