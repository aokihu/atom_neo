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

export function handleWsOpen(
  ws: ServerWebSocket<unknown>,
  ctx: ServerContext,
): void {
  // sessionId extracted from URL path: /ws/:sessionId
  const url = new URL(ws.remoteAddress ?? "", "http://localhost");
  // Actually in Bun, the path is available from the upgrade request
  // For simplicity, use a header or query param
}

export function createWsHandlers(ctx: ServerContext) {
  let sessionId = "";

  return {
    open(ws: ServerWebSocket<unknown>) {
      if (sessionId) ctx.broadcaster.add(ws, sessionId);
    },
    message(ws: ServerWebSocket<unknown>, msg: string | Buffer) {
      try {
        const data = JSON.parse(msg.toString());
        const { type, payload } = data;

        if (type === "event.task.submit") {
          sessionId = payload.sessionId;
          ctx.broadcaster.add(ws, sessionId);

          const task = createTaskItem({
            sessionId: payload.sessionId,
            chatId: payload.chatId,
            pipeline: payload.pipeline,
            source: TaskSource.EXTERNAL,
            payload: [{ type: "text", data: payload.data?.text ?? "" }],
          });

          ctx.taskQueue.enqueue(task);
          send(ws, "event.task.created", { taskId: task.id, state: task.state });

          ctx.bus?.emit("task.enqueued" as any, { task });
        } else if (type === "event.task.cancel") {
          ctx.taskQueue.remove(payload.taskId);
          send(ws, "event.task.state-changed", {
            taskId: payload.taskId,
            currentState: "failed",
          });
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
