import type { ServerWebSocket } from "bun";
import type { Broadcaster } from "./broadcaster";
import type { TaskQueue } from "../task-queue";
import type { PipelineEventBus, Logger } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { TaskSource, BusEvents, WsMessages, errorMessage } from "@atom-neo/shared";
import { createTaskItem } from "../task-factory";
import type { InternalTaskOrchestrator } from "../task/internal-task-orchestrator";

type ServerContext = {
  broadcaster: Broadcaster;
  taskQueue: TaskQueue;
  bus?: PipelineEventBus<FullEventMap>;
  logger?: Logger;
  orchestrator?: InternalTaskOrchestrator;
};

let seq = 0;

export function createWsHandlers(ctx: ServerContext) {
  function send(ws: ServerWebSocket<unknown>, type: string, payload: unknown) {
    try {
      ws.send(JSON.stringify({ type, seq: ++seq, ts: Date.now(), payload }));
    } catch (err) {
      ctx.logger?.error("ws send failed", { error: errorMessage(err) });
    }
  }

  return {
    open(ws: ServerWebSocket<unknown>) {
      const sid = (ws as any).data?.sessionId;
      if (sid) {
        ctx.broadcaster.add(ws, sid);
        send(ws, WsMessages.Server.SessionReady, { sessionId: sid });
      }
    },
    message(ws: ServerWebSocket<unknown>, msg: string | Buffer) {
      try {
        const data = JSON.parse(msg.toString());
        const { type, payload } = data;

        if (type === WsMessages.Client.TaskSubmit) {
          const sid = (ws as any).data?.sessionId;
          if (sid) {
            ctx.broadcaster.add(ws, sid);
            (ws as any).data.chatId = payload.chatId ?? "default";
          }

          const task = createTaskItem({
            sessionId: payload.sessionId,
            chatId: payload.chatId,
            pipeline: "conversation",
            source: TaskSource.EXTERNAL,
            payload: [{ type: "text", data: payload.data?.text ?? "" }],
          });

          ctx.taskQueue.enqueue(task);
          send(ws, WsMessages.Server.TaskCreated, { taskId: task.id, state: task.state });
          ctx.bus?.emit(BusEvents.Task.Enqueued as any, { task });
        } else if (type === WsMessages.Client.TaskCancel) {
          ctx.taskQueue.remove(payload.taskId);
          send(ws, WsMessages.Server.TaskStateChanged, { taskId: payload.taskId, currentState: "failed" });
        } else if (type === WsMessages.Control.Ping) {
          send(ws, WsMessages.Control.Pong, {});
        } else if (type === WsMessages.Client.Compact) {
          const sid = (ws as any).data?.sessionId;
          const cid = (ws as any).data?.chatId ?? "default";
          if (sid && ctx.orchestrator) {
            ctx.orchestrator.scheduleCompress(sid, cid, sid);
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
