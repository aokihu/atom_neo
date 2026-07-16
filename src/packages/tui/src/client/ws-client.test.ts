import { afterEach, describe, expect, test } from "bun:test";
import { WsMessages } from "@atom-neo/shared";
import { TuiClient } from "./ws-client";

class FakeWebSocket {
  static current: FakeWebSocket | undefined;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;

  constructor(_url: string) {
    FakeWebSocket.current = this;
  }

  send(_message: string): void {}
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
  test("ignores a failed internal task from an already completed request", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const taskIds = ["root-a", "root-b"];
    globalThis.fetch = (async () => Response.json({ taskId: taskIds.shift() })) as unknown as typeof fetch;

    const client = new TuiClient({ url: "http://localhost:3100", sessionId: "s1" });
    const connected = client.connect();
    const socket = FakeWebSocket.current!;
    socket.emit(WsMessages.Server.SessionReady, { sessionId: "s1" });
    await connected;

    const first = client.send("first");
    await nextTurn();
    socket.emit(WsMessages.Server.TaskCompleted, {
      taskId: "conversation-a",
      parentTaskId: "root-a",
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
});
