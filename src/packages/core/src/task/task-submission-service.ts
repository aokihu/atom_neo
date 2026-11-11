import { z } from "zod";
import { BusEvents, TaskSource, TaskState } from "@atom-neo/shared";
import type { FullEventMap, PipelineEventBus, SessionInitiator, TaskItem } from "@atom-neo/shared";
import { createTaskItem } from "../task-factory";
import type { TaskQueue } from "../task-queue";
import type { SessionStore } from "../session/store";

const SessionInitiatorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tui") }),
  z.object({ type: z.literal("gateway"), clientId: z.string().min(1), platform: z.string().min(1) }),
  z.object({ type: z.literal("internal") }),
  z.object({ type: z.literal("unknown") }),
]);

export const TaskSubmitSchema = z.object({
  sessionId: z.string().min(1),
  chatId: z.string().min(1).optional(),
  pipeline: z.string().min(1).optional(),
  text: z.string().optional(),
  initiator: SessionInitiatorSchema.optional(),
  platform: z.string().min(1).optional(),
});

export type TaskSubmitInput = z.infer<typeof TaskSubmitSchema>;

export type TaskSubmissionErrorCode = "INVALID_INPUT" | "PERSISTENCE_FAILED";

export class TaskSubmissionError extends Error {
  readonly code: TaskSubmissionErrorCode;

  constructor(code: TaskSubmissionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaskSubmissionError";
    this.code = code;
  }
}

export type TaskSubmissionServiceOptions = {
  taskQueue: TaskQueue;
  bus?: PipelineEventBus<FullEventMap>;
  sessionStore?: SessionStore;
  releaseTask?: (task: TaskItem) => boolean;
};

/** Shared HTTP/WebSocket task submission path: validate, checkpoint, create, enqueue. */
export class TaskSubmissionService {
  #taskQueue: TaskQueue;
  #bus?: PipelineEventBus<FullEventMap>;
  #sessionStore?: SessionStore;
  #releaseTask?: (task: TaskItem) => boolean;

  constructor(options: TaskSubmissionServiceOptions) {
    this.#taskQueue = options.taskQueue;
    this.#bus = options.bus;
    this.#sessionStore = options.sessionStore;
    this.#releaseTask = options.releaseTask;
  }

  submit(input: TaskSubmitInput): TaskItem {
    const parsed = TaskSubmitSchema.safeParse(input);
    if (!parsed.success) {
      throw new TaskSubmissionError("INVALID_INPUT", "Invalid task submission payload", { cause: parsed.error });
    }

    const submission = parsed.data;
    const initiator: SessionInitiator = submission.initiator ?? { type: "unknown" };
    const text = submission.text ?? "";

    if (this.#sessionStore) {
      this.#sessionStore.get(submission.sessionId, initiator);
      if (text && !this.#sessionStore.checkpointUserMessage(submission.sessionId, text)) {
        throw new TaskSubmissionError("PERSISTENCE_FAILED", "Failed to persist session message");
      }
    }

    const task = createTaskItem({
      sessionId: submission.sessionId,
      chatId: submission.chatId ?? "default",
      pipeline: submission.pipeline ?? "prediction",
      source: TaskSource.EXTERNAL,
      payload: [{ type: "text", data: text }],
      ...(submission.platform ? { platform: submission.platform } : {}),
    });

    if (this.#releaseTask) {
      this.#releaseTask(task);
      if (!this.#taskQueue.getStatus(task.id)) {
        task.state = TaskState.SUSPEND;
        this.#taskQueue.storeResult(task.id, { taskId: task.id, state: TaskState.SUSPEND });
      }
    } else {
      this.#taskQueue.enqueue(task);
      this.#bus?.emit(BusEvents.Task.Enqueued, { task });
    }

    return task;
  }
}
