/**
 * Session-scoped WebSocket fan-out. Peers are opaque transport handles; the
 * adapter is responsible for their readiness, broadcasting is protocol-only.
 */
import type { WebSocketPeer } from "@atom-neo/shared";

type WsPeer = WebSocketPeer<unknown>;

type Client = {
  ws: WsPeer;
  sessionId: string;
};

export class Broadcaster {
  #clients = new Map<WsPeer, Client>();
  #seq = 0;

  add(ws: WsPeer, sessionId: string): void {
    this.#clients.set(ws, { ws, sessionId });
  }

  remove(ws: WsPeer): void {
    this.#clients.delete(ws);
  }

  send(ws: WsPeer, type: string, payload: unknown): void {
    try {
      this.#sendSerialized(ws, this.#serialize(type, payload));
    } catch {
      // Ignore payload serialization failures.
    }
  }

  broadcastToSession(sessionId: string, type: string, payload: unknown): void {
    let data: string;
    try {
      data = this.#serialize(type, payload);
    } catch {
      return;
    }
    for (const c of this.#clients.values()) {
      if (c.sessionId === sessionId) this.#sendSerialized(c.ws, data);
    }
  }

  broadcast(type: string, payload: unknown): void {
    let data: string;
    try {
      data = this.#serialize(type, payload);
    } catch {
      return;
    }
    for (const c of this.#clients.values()) {
      this.#sendSerialized(c.ws, data);
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

  #serialize(type: string, payload: unknown): string {
    return JSON.stringify({
      type,
      seq: ++this.#seq,
      ts: Date.now(),
      payload,
    });
  }

  #sendSerialized(ws: WsPeer, data: string): void {
    try {
      ws.send(data);
    } catch {
      this.remove(ws);
    }
  }
}
