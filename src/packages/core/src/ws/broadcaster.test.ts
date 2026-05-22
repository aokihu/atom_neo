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
    bc.send(ws, { type: "test" });
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  test("broadcasts to session", () => {
    const bc = new Broadcaster();
    const ws1 = { send: mock(() => {}) } as any;
    const ws2 = { send: mock(() => {}) } as any;
    bc.add(ws1, "s1");
    bc.add(ws2, "s2");
    bc.broadcastToSession("s1", { type: "test" });
    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).toHaveBeenCalledTimes(0);
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
