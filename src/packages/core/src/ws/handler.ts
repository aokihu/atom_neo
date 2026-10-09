import type { ServerWebSocket } from "bun";
import type { Broadcaster } from "./broadcaster";
import type { TaskQueue } from "../task-queue";
import type { PipelineEventBus, Logger } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { TaskSource, BusEvents, WsMessages, errorMessage } from "@atom-neo/shared";
import { createTaskItem } from "../task-factory";
import type { InternalTaskOrchestrator } from "../task/internal-task-orchestrator";
import type { SessionStore } from "../session/store";
import type { TaskEngine } from "../task-engine";
import type { SessionContext } from "../session/context";
import type { SessionTelemetry } from "@atom-neo/shared";

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
  isStopping?: () => boolean;
  getLocalRoundLimit?: () => number;
};

export function createWsHandlers(ctx: ServerContext) {
  function send(ws: ServerWebSocket<unknown>, type: string, payload: unknown) {
    ctx.broadcaster.send(ws, type, payload);
  }

  return {
    open(ws: ServerWebSocket<unknown>) {
      const sid = (ws as any).data?.sessionId;
      if (sid) {
        ctx.broadcaster.add(ws, sid);
        const session = ctx.sessionStore?.load(sid);
        send(ws, WsMessages.Server.SessionReady, { sessionId: sid, messages: session?.messages ?? [], contextTokens: session?.contextTokens ?? 0, activeTaskIds: ctx.taskQueue.getSessionTasks(sid),
          telemetry: session ? buildSessionTelemetry(session, ctx.getLocalRoundLimit?.() ?? 5) : { sessionId: sid, rounds: null, todos: [] } });
      }
    },
    message(ws: ServerWebSocket<unknown>, msg: string | Buffer) {
      try {
        const data = JSON.parse(msg.toString());
        const { type, payload } = data;

        if (type === WsMessages.Client.TaskSubmit) {
          const sid = (ws as any).data?.sessionId;
          if (!sid || ctx.isStopping?.()) {
            send(ws, WsMessages.Control.Error, { message: "Core is stopping" });
            return;
          }
          ctx.broadcaster.add(ws, sid);
          (ws as any).data.chatId = payload.chatId ?? "default";

          const text = payload.data?.text ?? "";
          ctx.sessionStore?.get(sid, { type: "unknown" });
          if (text && ctx.sessionStore && !ctx.sessionStore.checkpointUserMessage(sid, text)) {
            send(ws, WsMessages.Control.Error, { message: "Failed to persist session message" });
            return;
          }

          const task = createTaskItem({
            sessionId: sid,
            chatId: payload.chatId ?? "default",
            pipeline: "conversation",
            source: TaskSource.EXTERNAL,
            payload: [{ type: "text", data: text }],
          });

          ctx.taskQueue.enqueue(task);
          send(ws, WsMessages.Server.TaskCreated, { taskId: task.id, state: task.state });
          ctx.bus?.emit(BusEvents.Task.Enqueued as any, { task });
        } else if (type === WsMessages.Client.TaskCancel) {
          const sid = (ws as any).data?.sessionId;
          if (!sid || !ctx.taskEngine?.cancel(payload.taskId, sid)) {
            send(ws, WsMessages.Control.Error, { message: "Task not found" });
            return;
          }
          send(ws, WsMessages.Server.TaskStateChanged, { taskId: payload.taskId, currentState: "cancelled" });
        } else if (type === WsMessages.Control.Ping) {
          send(ws, WsMessages.Control.Pong, {});
        } else if (type === WsMessages.Client.Compact) {
          const sid = (ws as any).data?.sessionId;
          const cid = (ws as any).data?.chatId ?? "default";
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
