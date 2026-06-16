import { useState, useRef, useCallback, useEffect } from "react";
import { TuiClient } from "../client/ws-client";
import type { Message, TodoItem } from "../types";

function now() { return Date.now(); }

export function useChat(url: string, sessionId?: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [tokenUsage, setTokenUsage] = useState(0);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
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

    client.onDelta((delta, offset) => {
      if (thinkingIdRef.current) {
        setMessages(prev => prev.filter(m => m.id !== thinkingIdRef.current));
        thinkingIdRef.current = null;
      }
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          const content = last.content.substring(0, offset) + delta;
          return [
            ...prev.slice(0, -1),
            { ...last, content },
          ];
        }
        const id = nextId();
        return [...prev, { role: "assistant", content: delta, id, streaming: true, timestamp: now() }];
      });
    });

    client.onTool((event) => {
      const id = nextId();
      if (event.error || event.result !== undefined) {
        setMessages(prev => {
          const toolMsg = prev.find(m => m.role === "tool" && m.toolCallId === event.callId && m.phase === "executing");
          if (toolMsg) {
            return prev.map(m => m.id === toolMsg.id
              ? { ...m, phase: event.error ? "error" as const : "done" as const, detail: String(event.error ?? event.result ?? "") }
              : m);
          }
          return [...prev, { role: "tool", toolCallId: event.callId, toolName: event.name, phase: event.error ? "error" as const : "done" as const, detail: String(event.error ?? event.result ?? ""), id, timestamp: now() }];
        });
      } else {
        setMessages(prev => [...prev, { role: "tool", toolCallId: event.callId, toolName: event.name, phase: "executing", input: event.input, id, timestamp: now() }]);
      }

      if (event.name === "todowrite" && event.input) {
        const todos = (event.input as any)?.todos;
        if (Array.isArray(todos)) setTodoItems(todos);
      }
    });

    client.connect().catch(() => {
      setMessages(prev => [...prev, { role: "error", content: "Connection failed", id: nextId(), timestamp: now() }]);
    });

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [url, sessionId]);

  const clearMessages = useCallback(() => {
    thinkingIdRef.current = null;
    setMessages([]);
  }, []);

  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const send = useCallback(async (text: string) => {
    const userMsgId = nextId();
    const thinkingId = nextId();
    const ts = now();
    thinkingIdRef.current = thinkingId;
    setMessages(prev => [
      ...prev,
      { role: "user", content: text, id: userMsgId, timestamp: ts },
      { role: "thinking", id: thinkingId, timestamp: ts },
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
      setMessages(prev => [...prev, { role: "error", content: err.message, id: nextId(), timestamp: now() }]);
      setSessionBusy(false);
    }
  }, []);

  return { messages, send, clearMessages, addMessage, tokenUsage, sessionBusy, todoItems };
}
