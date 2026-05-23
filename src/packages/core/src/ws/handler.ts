import type { ServerWebSocket } from "bun";
import type { Broadcaster } from "./broadcaster";
import type { TaskQueue } from "../task-queue";
import type { PipelineEventBus } from "@atom-neo/shared";
import type { FullEventMap } from "@atom-neo/shared";
import { createTaskItem } from "../task-factory";
import { TaskSource } from "@atom-neo/shared";

type ServerContext = {
  broadcaster: Broadcaster;
  taskQueue: TaskQueue;
  bus?: PipelineEventBus<FullEventMap>;
};

let seq = 0;

function send(ws: ServerWebSocket<unknown>, type: string, payload: unknown) {
  try {
    ws.send(JSON.stringify({ type, seq: ++seq, ts: Date.now(), payload }));
  } catch { /* ignore */ }
}

export function createWsHandlers(ctx: ServerContext) {
  return {
    open(ws: ServerWebSocket<unknown>) {
      const sid = (ws as any).data?.sessionId;
      if (sid) {
        ctx.broadcaster.add(ws, sid);
        send(ws, "session.ready", { sessionId: sid });
      }
    },
    message(ws: ServerWebSocket<unknown>, msg: string | Buffer) {
      try {
        const data = JSON.parse(msg.toString());
        const { type, payload } = data;

        if (type === "event.task.submit") {
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
          send(ws, "event.task.created", { taskId: task.id, state: task.state });
          ctx.bus?.emit("task.enqueued" as any, { task });
        } else if (type === "event.task.cancel") {
          ctx.taskQueue.remove(payload.taskId);
          send(ws, "event.task.state-changed", { taskId: payload.taskId, currentState: "failed" });
        } else if (type === "ping") {
          send(ws, "pong", {});
        }
      } catch {
        send(ws, "error", { message: "Invalid message format" });
      }
    },
    close(ws: ServerWebSocket<unknown>) {
      ctx.broadcaster.remove(ws);
    },
  };
}
