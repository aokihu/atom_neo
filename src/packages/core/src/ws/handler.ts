import type { ServerWebSocket } from "bun";
import type { Broadcaster } from "./broadcaster";
import type { TaskQueue } from "../task-queue";
import type { PipelineEventBus, Logger } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { WsMessages, errorMessage, isClientEventType } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../task/internal-task-orchestrator";
import type { SessionStore } from "../session/store";
import type { TaskEngine } from "../task-engine";
import type { SessionContext } from "../session/context";
import type { SessionTelemetry } from "@atom-neo/shared";
import { TaskSubmissionError, TaskSubmissionService, TaskSubmitSchema } from "../task/task-submission-service";

export function buildSessionTelemetry(session: SessionContext, localLimit: number): SessionTelemetry {
  const budget = session.executionBudget;
  return { sessionId: session.sessionId, todos: [...session.todoState], rounds: budget ? {
    goalId: budget.goalId, globalUsed: budget.globalUsed, globalAllowance: budget.globalAllowance,
    localUsed: budget.localUsed, localLimit, ...(budget.pause ? { pause: budget.pause } : {}),
    ...(budget.completed ? { completed: true } : {}),
  } : null };
}

type ServerContext = {
  broadcaster: Broadcaster;
  taskQueue: TaskQueue;
  bus?: PipelineEventBus<FullEventMap>;
  logger?: Logger;
  orchestrator?: InternalTaskOrchestrator;
  sessionStore?: SessionStore;
  taskEngine?: TaskEngine;
  taskSubmission?: TaskSubmissionService;
  isStopping?: () => boolean;
  getLocalRoundLimit?: () => number;
};

type WsData = {
  sessionId?: string;
  chatId?: string;
};

/** Bun stores the upgrade payload as `unknown`; keep the cast at this single boundary. */
function wsData(ws: ServerWebSocket<unknown>): WsData {
  return (ws.data ?? {}) as WsData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createWsHandlers(ctx: ServerContext) {
  const taskSubmission = ctx.taskSubmission ?? new TaskSubmissionService({
    taskQueue: ctx.taskQueue,
    bus: ctx.bus,
    sessionStore: ctx.sessionStore,
  });

  function send(ws: ServerWebSocket<unknown>, type: string, payload: unknown) {
    ctx.broadcaster.send(ws, type, payload);
  }

  function rejectSubmission(ws: ServerWebSocket<unknown>, error: unknown): void {
    if (error instanceof TaskSubmissionError) {
      send(ws, WsMessages.Control.Error, { message: error.message, code: error.code });
      return;
    }
    ctx.logger?.error("ws task submit failed", { error: errorMessage(error) });
    send(ws, WsMessages.Control.Error, { message: "Failed to create task" });
  }

  return {
    open(ws: ServerWebSocket<unknown>) {
      const sid = wsData(ws).sessionId;
      if (sid) {
        ctx.broadcaster.add(ws, sid);
        const session = ctx.sessionStore?.load(sid);
        send(ws, WsMessages.Server.SessionReady, { sessionId: sid, messages: session?.messages ?? [], contextTokens: session?.contextTokens ?? 0, activeTaskIds: ctx.taskQueue.getSessionTasks(sid),
          telemetry: session ? buildSessionTelemetry(session, ctx.getLocalRoundLimit?.() ?? 5) : { sessionId: sid, rounds: null, todos: [] } });
      }
    },
    message(ws: ServerWebSocket<unknown>, msg: string | Buffer) {
      try {
        const frame: unknown = JSON.parse(msg.toString());
        if (!isRecord(frame) || typeof frame.type !== "string") {
          send(ws, WsMessages.Control.Error, { message: "Invalid message format" });
          return;
        }
        if (!isClientEventType(frame.type)) return;

        const { type, payload } = frame;

        if (type === WsMessages.Client.TaskSubmit) {
          const sid = wsData(ws).sessionId;
          if (!sid || ctx.isStopping?.()) {
            send(ws, WsMessages.Control.Error, { message: "Core is stopping" });
            return;
          }
          ctx.broadcaster.add(ws, sid);

          const payloadRecord = isRecord(payload) ? payload : undefined;
          const data = payloadRecord?.data;
          if ((payload !== undefined && !payloadRecord) || (data !== undefined && !isRecord(data))) {
            send(ws, WsMessages.Control.Error, { message: "Invalid task submission payload", code: "INVALID_INPUT" });
            return;
          }
          const parsed = TaskSubmitSchema.safeParse({
            sessionId: sid,
            chatId: payloadRecord?.chatId,
            pipeline: payloadRecord?.pipeline,
            text: isRecord(data) ? data.text : undefined,
            initiator: { type: "unknown" },
          });
          if (!parsed.success) {
            send(ws, WsMessages.Control.Error, { message: "Invalid task submission payload", code: "INVALID_INPUT" });
            return;
          }

          try {
            const task = taskSubmission.submit(parsed.data);
            wsData(ws).chatId = task.chatId;
            send(ws, WsMessages.Server.TaskCreated, { taskId: task.id, state: task.state });
          } catch (error) {
            rejectSubmission(ws, error);
          }
        } else if (type === WsMessages.Client.TaskCancel) {
          const sid = wsData(ws).sessionId;
          const taskId = isRecord(payload) && typeof payload.taskId === "string" ? payload.taskId : undefined;
          if (!sid || !taskId || !ctx.taskEngine?.cancel(taskId, sid)) {
            send(ws, WsMessages.Control.Error, { message: "Task not found" });
            return;
          }
          send(ws, WsMessages.Server.TaskStateChanged, { taskId, currentState: "cancelled" });
        } else if (type === WsMessages.Control.Ping) {
          send(ws, WsMessages.Control.Pong, {});
        } else if (type === WsMessages.Client.Compact) {
          const sid = wsData(ws).sessionId;
          const cid = wsData(ws).chatId ?? "default";
          if (sid && ctx.orchestrator && !ctx.isStopping?.()) {
            ctx.logger?.info("compact requested", {
              sessionId: sid,
              chatId: cid,
              trigger: "manual",
              target: "context+messages",
              resumeConversation: false,
            });
            ctx.orchestrator.scheduleCompress(sid, cid, sid, {
              trigger: "manual",
              resumeConversation: false,
            });
          }
        }
      } catch (err) {
        ctx.logger?.error("ws message parse failed", { error: errorMessage(err) });
        send(ws, WsMessages.Control.Error, { message: "Invalid message format" });
      }
    },
    close(ws: ServerWebSocket<unknown>) {
      ctx.broadcaster.remove(ws);
    },
  };
}
