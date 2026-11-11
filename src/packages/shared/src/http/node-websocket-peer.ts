/**
 * Node `ws` peer adapter: one stable peer per socket, normalized frames and the
 * one-shot close/error lifecycle consumed by the Node HTTP adapter.
 */
import { WebSocket } from "ws";
import type { RawData } from "ws";
import type { WebSocketHandlers, WebSocketPeer } from "./types";

/** `ws` may deliver fragmented frames as `Buffer[]`; join before decoding. */
function toBuffer(raw: RawData): Buffer {
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
}

/** Text frames become strings; binary frames stay `Uint8Array` for the handler. */
export function normalizeMessage(raw: RawData, isBinary: boolean): string | Uint8Array {
  const buffer = toBuffer(raw);
  return isBinary ? new Uint8Array(buffer) : buffer.toString();
}

/** One peer per socket so broadcaster add/remove always sees the same object. */
export function createPeerRegistry<TData>(): (socket: WebSocket, data: TData) => WebSocketPeer<TData> {
  const peers = new WeakMap<WebSocket, WebSocketPeer<TData>>();
  return (socket, data) => {
    let peer = peers.get(socket);
    if (!peer) {
      peer = {
        data,
        send(payload) {
          if (socket.readyState === WebSocket.OPEN) socket.send(payload);
        },
        close(code, reason) {
          socket.close(code, reason);
        },
      };
      peers.set(socket, peer);
    }
    return peer;
  };
}

/** Wire handlers to a `ws` socket; close runs once for both close and error. */
export function attachPeerHandlers<TData>(
  socket: WebSocket,
  peer: WebSocketPeer<TData>,
  handlers: WebSocketHandlers<TData>,
): void {
  let closed = false;
  const closeOnce = (code?: number, reason?: string) => {
    if (closed) return;
    closed = true;
    handlers.close?.(peer, code, reason);
  };

  socket.on("message", (raw, isBinary) => handlers.message?.(peer, normalizeMessage(raw, isBinary)));
  socket.on("close", (code, reason) => closeOnce(code, reason.toString()));
  socket.on("error", () => {
    try {
      closeOnce();
    } finally {
      socket.terminate();
    }
  });
  socket.on("drain", () => handlers.drain?.(peer));
  handlers.open?.(peer);
}
