import { useState, useRef, useCallback, useEffect } from "react";
import { TuiClient } from "../client/ws-client";
import type { Message, TodoItem, ToolEntry } from "../types";

function now() { return Date.now(); }

export function useChat(url: string, sessionId?: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [tokenUsage, setTokenUsage] = useState(0);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const clientRef = useRef<TuiClient | null>(null);
  const thinkingIdRef = useRef<string | null>(null);
  const toolGroupIdRef = useRef<string | null>(null);
  const autoThinkingRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      clearTimeout(autoThinkingRef.current);
      autoThinkingRef.current = undefined;
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
      const callId = event.callId;
      const isResult = event.error || event.result !== undefined;

      clearTimeout(autoThinkingRef.current);
      autoThinkingRef.current = undefined;

      setMessages(prev => {
        const groupIdx = toolGroupIdRef.current
          ? prev.findIndex(m => m.role === "tool-group" && m.id === toolGroupIdRef.current)
          : -1;

        if (groupIdx >= 0) {
          return prev.map((m, i) => {
            if (i !== groupIdx) return m;
            const group = m as Extract<Message, { role: "tool-group" }>;
            const existingIdx = group.entries.findIndex(e => e.toolCallId === callId);
            if (existingIdx >= 0) {
              const updated = [...group.entries];
              if (isResult) {
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  phase: event.error ? "error" as const : "done" as const,
                  detail: String(event.error ?? event.result ?? ""),
                };
              }
              return { ...group, entries: updated };
            }
            return {
              ...group,
              entries: [...group.entries, {
                toolCallId: callId,
                toolName: event.name,
                phase: isResult ? (event.error ? "error" as const : "done" as const) : "executing" as const,
                input: event.input,
                detail: isResult ? String(event.error ?? event.result ?? "") : undefined,
              }],
            };
          });
        }

        const newGroupId = nextId();
        toolGroupIdRef.current = newGroupId;
        const newEntry: ToolEntry = {
          toolCallId: callId,
          toolName: event.name,
          phase: isResult ? (event.error ? "error" as const : "done" as const) : "executing" as const,
          input: event.input,
          detail: isResult ? String(event.error ?? event.result ?? "") : undefined,
        };
        const newGroup = {
          role: "tool-group" as const,
          id: newGroupId,
          timestamp: now(),
          entries: [newEntry],
          collapsed: false,
        };
        const lastInPrev = prev[prev.length - 1];
        if (lastInPrev?.role === "thinking" && lastInPrev.id === thinkingIdRef.current) {
          return [...prev.slice(0, -1), newGroup, lastInPrev];
        }
        return [...prev, newGroup];
      });

      if (event.name === "todowrite" && event.input) {
        const todos = (event.input as any)?.todos;
        if (Array.isArray(todos)) setTodoItems(todos);
      }
    });

    client.onToolStepFinish((event) => {
      if (!toolGroupIdRef.current) return;
      setMessages(prev => prev.map(m => {
        if (m.role !== "tool-group" || m.id !== toolGroupIdRef.current) return m;
        return {
          ...m,
          collapsed: true,
          summary: {
            total: event.total,
            success: event.success,
            failed: event.failed,
            toolNames: event.toolNames,
          },
        };
      }));
    });

    client.onBusyChange((busy) => {
      setSessionBusy(busy);
      if (busy) {
        if (!thinkingIdRef.current && !autoThinkingRef.current) {
          autoThinkingRef.current = setTimeout(() => {
            if (thinkingIdRef.current) return;
            const id = nextId();
            thinkingIdRef.current = id;
            setMessages(prev => [...prev, { role: "thinking" as const, id, timestamp: now() }]);
          }, 1500);
        }
      } else {
        clearTimeout(autoThinkingRef.current);
        autoThinkingRef.current = undefined;
        if (thinkingIdRef.current) {
          setMessages(prev => prev.filter(m => m.id !== thinkingIdRef.current));
          thinkingIdRef.current = null;
        }
      }
    });

    client.connect().catch(() => {
      setMessages(prev => [...prev, { role: "error", content: "Connection failed", id: nextId(), timestamp: now() }]);
    });

    return () => {
      clearTimeout(autoThinkingRef.current);
      autoThinkingRef.current = undefined;
      client.close();
      clientRef.current = null;
    };
  }, [url, sessionId]);

  const clearMessages = useCallback(() => {
    thinkingIdRef.current = null;
    clearTimeout(autoThinkingRef.current);
    autoThinkingRef.current = undefined;
    setMessages([]);
  }, []);

  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const send = useCallback(async (text: string) => {
    toolGroupIdRef.current = null;
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
      clearTimeout(autoThinkingRef.current);
      autoThinkingRef.current = undefined;
    } catch (err: any) {
      thinkingIdRef.current = null;
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      setMessages(prev => [...prev, { role: "error", content: err.message, id: nextId(), timestamp: now() }]);
    }
  }, []);

  return { messages, send, clearMessages, addMessage, tokenUsage, sessionBusy, todoItems };
}
