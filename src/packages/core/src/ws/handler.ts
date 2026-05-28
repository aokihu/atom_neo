import type { ServerWebSocket } from "bun";
import type { Broadcaster } from "./broadcaster";
import type { TaskQueue } from "../task-queue";
import type { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import type { Logger } from "@atom-neo/shared";
import { TaskSource, BusEvents, WsMessages } from "@atom-neo/shared";
import { createTaskItem } from "../task-factory";

type ServerContext = {
  broadcaster: Broadcaster;
  taskQueue: TaskQueue;
  bus?: PipelineEventBus<FullEventMap>;
  logger?: Logger;
};

let seq = 0;

export function createWsHandlers(ctx: ServerContext) {
  function send(ws: ServerWebSocket<unknown>, type: string, payload: unknown) {
    try {
      ws.send(JSON.stringify({ type, seq: ++seq, ts: Date.now(), payload }));
    } catch (err) {
      ctx.logger?.error("ws send failed", { error: String(err) });
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
          if (sid) ctx.broadcaster.add(ws, sid);

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
        }
      } catch (err) {
        ctx.logger?.error("ws message parse failed", { error: String(err) });
        send(ws, WsMessages.Control.Error, { message: "Invalid message format" });
      }
    },
    close(ws: ServerWebSocket<unknown>) {
      ctx.broadcaster.remove(ws);
    },
  };
}
