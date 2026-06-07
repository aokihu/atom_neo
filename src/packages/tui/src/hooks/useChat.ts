import { useState, useRef, useCallback, useEffect } from "react";
import { TuiClient } from "../client/ws-client";
import type { Message } from "../types";

export function useChat(url: string, sessionId?: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [tokenUsage, setTokenUsage] = useState(0);
  const [sessionBusy, setSessionBusy] = useState(false);
  const clientRef = useRef<TuiClient | null>(null);
  const thinkingIdRef = useRef<string | null>(null);
  const counterRef = useRef(0);

  function nextId() { return `msg-${Date.now()}-${++counterRef.current}`; }

  useEffect(() => {
    const client = new TuiClient({ url, sessionId });
    clientRef.current = client;

    client.onTokenUsage((total) => {
      setTokenUsage(total);
    });

    client.onDelta((delta) => {
      if (thinkingIdRef.current) {
        setMessages(prev => prev.filter(m => m.id !== thinkingIdRef.current));
        thinkingIdRef.current = null;
      }
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

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [url, sessionId]);

  const send = useCallback(async (text: string) => {
    const userMsgId = nextId();
    const thinkingId = nextId();
    thinkingIdRef.current = thinkingId;
    setMessages(prev => [
      ...prev,
      { role: "user", content: text, id: userMsgId },
      { role: "thinking", id: thinkingId },
    ]);
    setSessionBusy(true);

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
      if (thinkingIdRef.current) {
        setMessages(prev => prev.filter(m => m.id !== thinkingIdRef.current));
        thinkingIdRef.current = null;
      }
      setSessionBusy(false);
    } catch (err: any) {
      thinkingIdRef.current = null;
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      setMessages(prev => [...prev, { role: "error", content: err.message, id: nextId() }]);
      setSessionBusy(false);
    }
  }, []);

  return { messages, send, tokenUsage, sessionBusy };
}
