import { useState, useRef, useCallback, useEffect } from "react";
import { TuiClient } from "../client/ws-client";
import type { Message } from "../types";

let msgCounter = 0;
function nextId() { return `msg-${Date.now()}-${++msgCounter}`; }

export function useChat(url: string, sessionId?: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const clientRef = useRef<TuiClient | null>(null);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (connectedRef.current) return;
    connectedRef.current = true;

    const client = new TuiClient({ url, sessionId });
    clientRef.current = client;

    client.onDelta((delta) => {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + delta },
          ];
        }
        const id = nextId();
        return [...prev, { role: "assistant", content: delta, id, streaming: true }];
      });
    });

    client.onTool((event) => {
      const id = nextId();
      if (event.error || event.result !== undefined) {
        setMessages(prev => {
          const toolMsg = prev.find(m => m.role === "tool" && m.toolName === event.name && m.state === "running");
          if (toolMsg) {
            return prev.map(m => m.id === toolMsg.id
              ? { ...m, state: event.error ? "error" as const : "done" as const, detail: String(event.error ?? event.result ?? "") }
              : m);
          }
          return [...prev, { role: "tool", toolName: event.name, state: event.error ? "error" as const : "done" as const, detail: String(event.error ?? event.result ?? ""), id }];
        });
      } else {
        setMessages(prev => [...prev, { role: "tool", toolName: event.name, state: "running", id }]);
      }
    });

    client.connect().catch(() => {
      setMessages(prev => [...prev, { role: "error", content: "Connection failed", id: nextId() }]);
    });
  }, [url, sessionId]);

  const send = useCallback(async (text: string) => {
    const id = nextId();
    setMessages(prev => [...prev, { role: "user", content: text, id }]);

    try {
      const client = clientRef.current;
      if (!client) throw new Error("Not connected");
      await client.send(text);

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          return prev.map(m => m.id === last.id ? { ...m, streaming: false } : m);
        }
        return prev;
      });
    } catch (err: any) {
      setMessages(prev => [...prev, { role: "error", content: err.message, id: nextId() }]);
    }
  }, []);

  return { messages, send };
}
