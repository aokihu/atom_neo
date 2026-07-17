import { describe, test, expect, mock } from "bun:test";
import { Broadcaster } from "./broadcaster";

describe("Broadcaster", () => {
  test("adds and removes clients", () => {
    const bc = new Broadcaster();
    const ws = { send: mock(() => {}) } as any;
    bc.add(ws, "s1");
    expect(bc.connectedClients).toBe(1);
    bc.remove(ws);
    expect(bc.connectedClients).toBe(0);
  });

  test("sends to client", () => {
    const bc = new Broadcaster();
    const ws = { send: mock(() => {}) } as any;
    bc.add(ws, "s1");
    bc.send(ws, "test", { ok: true });
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({
      type: "test",
      seq: 1,
      payload: { ok: true },
    });
  });

  test("broadcasts to session", () => {
    const bc = new Broadcaster();
    const ws1 = { send: mock(() => {}) } as any;
    const ws2 = { send: mock(() => {}) } as any;
    bc.add(ws1, "s1");
    bc.add(ws2, "s2");
    bc.broadcastToSession("s1", "test", {});
    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).toHaveBeenCalledTimes(0);
  });

  test("assigns one process-wide monotonic sequence across every send path", () => {
    const bc = new Broadcaster();
    const ws1 = { send: mock(() => {}) } as any;
    const ws2 = { send: mock(() => {}) } as any;
    bc.add(ws1, "s1");
    bc.add(ws2, "s1");

    bc.send(ws1, "direct", {});
    bc.broadcastToSession("s1", "session", {});
    bc.broadcast("global", {});

    const messages1 = ws1.send.mock.calls.map(([value]: [string]) => JSON.parse(value));
    const messages2 = ws2.send.mock.calls.map(([value]: [string]) => JSON.parse(value));
    expect(messages1.map((message: { seq: number }) => message.seq)).toEqual([1, 2, 3]);
    expect(messages2.map((message: { seq: number }) => message.seq)).toEqual([2, 3]);
  });

  test("counts unique sessions", () => {
    const bc = new Broadcaster();
    const ws1 = { send: mock(() => {}) } as any;
    const ws2 = { send: mock(() => {}) } as any;
    bc.add(ws1, "s1");
    bc.add(ws2, "s1");
    expect(bc.connectedSessions).toBe(1);
    expect(bc.connectedClients).toBe(2);
  });
});
