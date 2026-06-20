import { useState, useRef, useCallback, useEffect } from "react";
import { TuiClient } from "../client/ws-client";
import type { Message, TodoItem, ToolEntry, ToolInfo, MCPServerInfo } from "../types";

function now() { return Date.now(); }

const FLUSH_DELAY = 1000;
const QUICK_RENDER_MS = 20;
const QUICK_RENDER_CHUNK = 3;

export function useChat(url: string, sessionId?: string, initialToolInfos?: ToolInfo[], initialMCPServers?: MCPServerInfo[]) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [tokenUsage, setTokenUsage] = useState(0);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [toolInfos, setToolInfos] = useState<ToolInfo[]>(initialToolInfos ?? []);
  const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>(initialMCPServers ?? []);
  const clientRef = useRef<TuiClient | null>(null);
  const toolGroupIdRef = useRef<string | null>(null);
  const stepAccumRef = useRef({ total: 0, success: 0, failed: 0, toolNames: [] as string[] });
  const bufferingRef = useRef(false);
  const textBufferRef = useRef("");
  const bufferOffsetRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const counterRef = useRef(0);

  function nextId() { return `msg-${Date.now()}-${++counterRef.current}`; }

  function stopFlush() {
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = undefined;
    clearInterval(flushIntervalRef.current);
    flushIntervalRef.current = undefined;
  }

  function startQuickRender() {
    stopFlush();
    if (!textBufferRef.current) { bufferingRef.current = false; return; }
    const id = nextId();
    let started = false;
    flushIntervalRef.current = setInterval(() => {
      const off = bufferOffsetRef.current;
      const total = textBufferRef.current.length;
      if (off >= total) {
        stopFlush();
        bufferingRef.current = false;
        if (!started) return;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            return prev.map(m => m.id === last.id ? { ...m, streaming: false } : m);
          }
          return prev;
        });
        return;
      }
      const chunk = textBufferRef.current.slice(off, off + QUICK_RENDER_CHUNK);
      bufferOffsetRef.current = off + chunk.length;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.streaming && started) {
          return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
        }
        started = true;
        return [...prev, { role: "assistant", content: chunk, id, streaming: true, timestamp: now() }];
      });
    }, QUICK_RENDER_MS);
  }

  function resetBuffer() {
    stopFlush();
    bufferingRef.current = false;
    textBufferRef.current = "";
    bufferOffsetRef.current = 0;
  }

  useEffect(() => {
    const client = new TuiClient({ url, sessionId });
    clientRef.current = client;

    client.onTokenUsage((total) => {
      setTokenUsage(total);
    });

    client.onDelta((delta, offset) => {
      if (bufferingRef.current) {
        textBufferRef.current += delta;
        return;
      }

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content.substring(0, offset) + delta },
          ];
        }
        const id = nextId();
        return [...prev, { role: "assistant", content: delta, id, streaming: true, timestamp: now() }];
      });
    });

    client.onReason((delta, _offset) => {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "reasoning") {
          return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
        }
        return [...prev, { role: "reasoning" as const, content: delta, id: nextId(), timestamp: now() }];
      });
    });

    client.onTool((event) => {
      const callId = event.callId;
      const isResult = event.error || event.result !== undefined;

      setMessages(prev => {
        const groupIdx = toolGroupIdRef.current
          ? prev.findIndex(m => m.role === "tool-group" && m.id === toolGroupIdRef.current)
          : -1;

        if (groupIdx >= 0) {
          stopFlush();
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

        resetBuffer();
        bufferingRef.current = true;
        const newGroupId = nextId();
        toolGroupIdRef.current = newGroupId;
        stepAccumRef.current = { total: 0, success: 0, failed: 0, toolNames: [] };
        return [...prev, {
          role: "tool-group" as const,
          id: newGroupId,
          timestamp: now(),
          entries: [{
            toolCallId: callId,
            toolName: event.name,
            phase: isResult ? (event.error ? "error" as const : "done" as const) : "executing" as const,
            input: event.input,
            detail: isResult ? String(event.error ?? event.result ?? "") : undefined,
          }],
          collapsed: false,
        }];
      });

      if (event.name === "todowrite" && event.input) {
        const todos = (event.input as any)?.todos;
        if (Array.isArray(todos)) setTodoItems(todos);
      }
    });

    client.onToolStepFinish((event) => {
      if (!toolGroupIdRef.current) return;
      const acc = stepAccumRef.current;
      acc.total += event.total;
      acc.success += event.success;
      acc.failed += event.failed;
      acc.toolNames.push(...event.toolNames);
      setMessages(prev => prev.map(m => {
        if (m.role !== "tool-group" || m.id !== toolGroupIdRef.current) return m;
        return {
          ...m,
          collapsed: true,
          summary: { ...acc },
        };
      }));

      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(startQuickRender, FLUSH_DELAY);
    });

    client.onBusyChange((busy) => {
      setSessionBusy(busy);
      if (!busy && bufferingRef.current) startQuickRender();
    });

    client.onMCPConnected((data) => {
      setMcpServers(data.servers.map(s => ({ name: s.name, online: s.online, toolCount: s.toolCount })));
      setToolInfos(prev => [...prev.filter(t => t.source !== "mcp"), ...data.toolInfos.map(t => ({ ...t, source: t.source as ToolInfo["source"] }))]);
    });

    client.onMCPStatus((servers) => {
      setMcpServers(prev =>
        prev.map(s => {
          const updated = servers.find(ss => ss.name === s.name);
          return updated ? { ...s, online: updated.online } : s;
        })
      );
    });

    client.connect().catch(() => {
      setMessages(prev => [...prev, { role: "error", content: "Connection failed", id: nextId(), timestamp: now() }]);
    });

    return () => {
      resetBuffer();
      client.close();
      clientRef.current = null;
    };
  }, [url, sessionId]);

  const clearMessages = useCallback(() => {
    resetBuffer();
    setMessages([]);
  }, []);

  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const send = useCallback(async (text: string) => {
    toolGroupIdRef.current = null;
    stepAccumRef.current = { total: 0, success: 0, failed: 0, toolNames: [] };
    resetBuffer();
    setMessages(prev => [...prev, { role: "user", content: text, id: nextId(), timestamp: now() }]);
    setSessionBusy(true);

    try {
      const client = clientRef.current;
      if (!client) throw new Error("Not connected");
      await client.send(text);

      resetBuffer();
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          return prev.map(m => m.id === last.id ? { ...m, streaming: false } : m);
        }
        return prev;
      });
    } catch (err: any) {
      resetBuffer();
      setMessages(prev => [...prev, { role: "error", content: err.message, id: nextId(), timestamp: now() }]);
    }
  }, []);

  return { messages, send, clearMessages, addMessage, tokenUsage, sessionBusy, todoItems, toolInfos, mcpServers };
}
