import type { ServerWebSocket } from "bun";

type Client = {
  ws: ServerWebSocket<unknown>;
  sessionId: string;
};

export class Broadcaster {
  #clients = new Map<ServerWebSocket<unknown>, Client>();

  add(ws: ServerWebSocket<unknown>, sessionId: string): void {
    this.#clients.set(ws, { ws, sessionId });
  }

  remove(ws: ServerWebSocket<unknown>): void {
    this.#clients.delete(ws);
  }

  send(ws: ServerWebSocket<unknown>, data: unknown): void {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      this.remove(ws);
    }
  }

  broadcastToSession(sessionId: string, data: unknown): void {
    for (const c of this.#clients.values()) {
      if (c.sessionId === sessionId) this.send(c.ws, data);
    }
  }

  broadcast(data: unknown): void {
    for (const c of this.#clients.values()) {
      this.send(c.ws, data);
    }
  }

  get connectedSessions(): number {
    const ids = new Set<string>();
    for (const c of this.#clients.values()) ids.add(c.sessionId);
    return ids.size;
  }

  get connectedClients(): number {
    return this.#clients.size;
  }
}
