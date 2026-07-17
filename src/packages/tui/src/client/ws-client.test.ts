import { afterEach, describe, expect, test } from "bun:test";
import { WsMessages } from "@atom-neo/shared";
import { TuiClient } from "./ws-client";

class FakeWebSocket {
  static current: FakeWebSocket | undefined;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;

  constructor(_url: string) {
    FakeWebSocket.current = this;
  }

  send(message: string): void { this.sent.push(message); }
  close(): void { this.onclose?.(); }

  emit(type: string, payload: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify({ type, payload }) });
  }
}

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
  FakeWebSocket.current = undefined;
});

describe("TuiClient task correlation", () => {
  test("waits for the explicit terminal event and ignores events from completed requests", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const taskIds = ["root-a", "root-b"];
    globalThis.fetch = (async () => Response.json({ taskId: taskIds.shift() })) as unknown as typeof fetch;

    const client = new TuiClient({ url: "http://localhost:3100", sessionId: "s1" });
    const connected = client.connect();
    const socket = FakeWebSocket.current!;
    socket.emit(WsMessages.Server.SessionReady, { sessionId: "s1" });
    await connected;

    const first = client.send("first");
    let firstSettled = false;
    void first.finally(() => { firstSettled = true; });
    await nextTurn();
    socket.emit(WsMessages.Server.TaskCompleted, {
      taskId: "conversation-a",
      rootTaskId: "root-a",
      parentTaskId: "root-a",
      terminal: false,
    });
    await nextTurn();
    expect(firstSettled).toBe(false);
    socket.emit(WsMessages.Server.TaskCompleted, {
      taskId: "post-check-a",
      rootTaskId: "root-a",
      parentTaskId: "root-a",
      terminal: true,
    });
    await expect(first).resolves.toBe("");

    let secondSettled = false;
    const second = client.send("second");
    void second.then(
      () => { secondSettled = true; },
      () => { secondSettled = true; },
    );
    await nextTurn();
    socket.emit(WsMessages.Server.TaskFailed, {
      taskId: "post-check-a",
      rootTaskId: "root-a",
      error: "late failure",
    });
    await nextTurn();

    expect(secondSettled).toBe(false);
    socket.emit(WsMessages.Server.TaskFailed, {
      taskId: "conversation-b",
      rootTaskId: "root-b",
      error: "current failure",
    });
    await expect(second).rejects.toThrow("current failure");
    client.close();
  });

  test("resolves a terminal root task that has no child", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    globalThis.fetch = (async () => Response.json({ taskId: "root-1" })) as unknown as typeof fetch;

    const client = new TuiClient({ url: "http://localhost:3100", sessionId: "s1" });
    const connected = client.connect();
    const socket = FakeWebSocket.current!;
    socket.emit(WsMessages.Server.SessionReady, { sessionId: "s1" });
    await connected;

    const request = client.send("finish at root");
    await nextTurn();
    socket.emit(WsMessages.Server.TaskCompleted, {
      taskId: "root-1",
      rootTaskId: "root-1",
      parentTaskId: "root-1",
      terminal: true,
    });

    await expect(request).resolves.toBe("");
    client.close();
  });

  test("rejects failed or malformed task creation without opening a pending request", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const responses = [
      Response.json({ error: "persist failed" }, { status: 500 }),
      Response.json({}, { status: 201 }),
    ];
    globalThis.fetch = (async () => responses.shift()!) as unknown as typeof fetch;

    const client = new TuiClient({ url: "http://localhost:3100", sessionId: "s1" });
    const connected = client.connect();
    FakeWebSocket.current!.emit(WsMessages.Server.SessionReady, { sessionId: "s1" });
    await connected;

    await expect(client.send("checkpoint fails")).rejects.toThrow("persist failed");
    await expect(client.send("missing id")).rejects.toThrow("Invalid task submission response");
    client.close();
  });

  test("cancels the active task over the session WebSocket", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const client = new TuiClient({ url: "http://localhost:3100", sessionId: "s1" });
    const connected = client.connect();
    const socket = FakeWebSocket.current!;
    socket.emit(WsMessages.Server.SessionReady, { sessionId: "s1" });
    await connected;

    expect(client.cancelActiveTask()).toBe(false);
    socket.emit(WsMessages.Server.SessionTaskActive, { active: true, taskId: "task-1" });
    expect(client.cancelActiveTask()).toBe(true);
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: WsMessages.Client.TaskCancel,
      payload: { taskId: "task-1" },
    });

    socket.emit(WsMessages.Server.SessionTaskActive, { active: false, taskId: "task-1" });
    expect(client.cancelActiveTask()).toBe(false);
    client.close();
  });

  test("marks a user cancellation as TaskCancelledError", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    globalThis.fetch = (async () => Response.json({ taskId: "root-1" })) as unknown as typeof fetch;
    const client = new TuiClient({ url: "http://localhost:3100", sessionId: "s1" });
    const connected = client.connect();
    const socket = FakeWebSocket.current!;
    socket.emit(WsMessages.Server.SessionReady, { sessionId: "s1" });
    await connected;

    const request = client.send("cancel me");
    await nextTurn();
    socket.emit(WsMessages.Server.TaskFailed, {
      taskId: "conversation-1",
      rootTaskId: "root-1",
      code: "PIPELINE_ABORTED",
      error: "Task cancelled by user",
    });

    await expect(request).rejects.toMatchObject({ name: "TaskCancelledError" });
    client.close();
  });
});
