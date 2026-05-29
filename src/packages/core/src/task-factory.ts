import { TaskSource, TaskState } from "@atom-neo/shared";
import type { TaskItem, TaskPayload } from "@atom-neo/shared";

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
    priority: params.source === TaskSource.EXTERNAL ? 10 : 5,
    createdAt: now,
    payload: params.payload,
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
  });
}
