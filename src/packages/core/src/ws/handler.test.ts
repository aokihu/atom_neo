import { describe, expect, mock, test } from "bun:test";
import { BusEvents, PipelineEventBus, WsMessages } from "@atom-neo/shared";
import type { FullEventMap, TaskItem } from "@atom-neo/shared";
import { SessionStore } from "../session/store";
import { TaskQueue } from "../task-queue";
import { Broadcaster } from "./broadcaster";
import { createWsHandlers } from "./handler";

const createWebSocket = (sessionId: string) => ({
  data: { sessionId },
  send: mock(() => {}),
}) as any;

const submit = (handlers: ReturnType<typeof createWsHandlers>, ws: any, sessionId = "payload-session") => {
  handlers.message(ws, JSON.stringify({
    type: WsMessages.Client.TaskSubmit,
    payload: {
      sessionId,
      chatId: "chat",
      data: { text: "persist me" },
    },
  }));
};

describe("WebSocket session persistence", () => {
  test("uses the broadcaster sequence for direct WebSocket responses", () => {
    const broadcaster = new Broadcaster();
    const handlers = createWsHandlers({
      broadcaster,
      taskQueue: new TaskQueue(),
    });
    const ws = createWebSocket("url-session");

    handlers.open(ws);
    broadcaster.broadcastToSession("url-session", "server-event", {});

    const messages = ws.send.mock.calls.map(([value]: [string]) => JSON.parse(value));
    expect(messages.map((message: { seq: number }) => message.seq)).toEqual([1, 2]);
  });

  test("uses the URL session and checkpoints before enqueue", () => {
    const checkpoint = mock(() => {});
    const store = new SessionStore(10, undefined, 0, {
      restore: () => null,
      checkpoint,
      remove: () => {},
    } as any);
    const queue = new TaskQueue();
    const bus = new PipelineEventBus<FullEventMap>();
    let enqueued: TaskItem | undefined;
    bus.on(BusEvents.Task.Enqueued, ({ task }) => { enqueued = task; });
    const handlers = createWsHandlers({
      broadcaster: new Broadcaster(),
      taskQueue: queue,
      bus,
      sessionStore: store,
    });
    const ws = createWebSocket("url-session");

    submit(handlers, ws);

    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(store.get("url-session").messages[0]?.content).toBe("persist me");
    expect(enqueued?.sessionId).toBe("url-session");
    expect(queue.waiting).toBe(1);
  });

  test("does not enqueue when the message checkpoint fails", () => {
    const store = new SessionStore(10, undefined, 0, {
      restore: () => null,
      checkpoint: () => { throw new Error("disk full"); },
      remove: () => {},
    } as any);
    const queue = new TaskQueue();
    const handlers = createWsHandlers({
      broadcaster: new Broadcaster(),
      taskQueue: queue,
      sessionStore: store,
    });
    const ws = createWebSocket("url-session");

    submit(handlers, ws);

    expect(queue.waiting).toBe(0);
    expect(store.get("url-session").messages).toHaveLength(0);
    expect(ws.send.mock.calls.some(([value]: [string]) => value.includes("Failed to persist"))).toBe(true);
  });

  test("cancels through TaskEngine using the URL session", () => {
    const cancel = mock(() => true);
    const handlers = createWsHandlers({
      broadcaster: new Broadcaster(),
      taskQueue: new TaskQueue(),
      taskEngine: { cancel } as any,
    });
    const ws = createWebSocket("url-session");

    handlers.message(ws, JSON.stringify({
      type: WsMessages.Client.TaskCancel,
      payload: { taskId: "task-1", sessionId: "payload-session" },
    }));

    expect(cancel).toHaveBeenCalledWith("task-1", "url-session");
    expect(ws.send.mock.calls.some(([value]: [string]) => value.includes("\"currentState\":\"cancelled\""))).toBe(true);
  });

  test("does not reveal a task owned by another session", () => {
    const handlers = createWsHandlers({
      broadcaster: new Broadcaster(),
      taskQueue: new TaskQueue(),
      taskEngine: { cancel: () => false } as any,
    });
    const ws = createWebSocket("url-session");

    handlers.message(ws, JSON.stringify({
      type: WsMessages.Client.TaskCancel,
      payload: { taskId: "other-session-task" },
    }));

    expect(ws.send.mock.calls.some(([value]: [string]) => value.includes("Task not found"))).toBe(true);
  });
});
