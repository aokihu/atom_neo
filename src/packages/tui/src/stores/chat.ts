import { create } from "zustand";
import type { Message, TodoItem, ToolInfo, MCPServerInfo } from "../types";

let _counter = 0;
function now() { return Date.now(); }

type ToolEventParams = {
  name: string;
  callId: string;
  input?: unknown;
  result?: unknown;
  error?: unknown;
};

type ChatState = {
  messages: Message[];
  toolGroupId: string | null;
  busy: boolean;
  showPreparing: boolean;
  tokenUsage: number;
  todoItems: TodoItem[];
  toolInfos: ToolInfo[];
  mcpServers: MCPServerInfo[];

  generateId: () => string;
  addMessage: (msg: Message) => void;
  updateMessage: (id: string, patch: Partial<Message>) => void;
  clearMessages: () => void;

  handleDelta: (delta: string, offset: number, reasoning?: string, thinkingDuration?: number) => void;
  handleReason: (delta: string) => void;
  handleToolEvent: (event: ToolEventParams) => "created" | "updated" | null;
  handleToolStepFinish: (total: number, success: number, failed: number, toolNames: string[]) => void;
  handleToolGroupComplete: (total: number, success: number, failed: number, toolNames: string[]) => void;

  setBusy: (busy: boolean) => void;
  setTokenUsage: (total: number) => void;
  setTodoItems: (todos: TodoItem[]) => void;
  setToolInfos: (infos: ToolInfo[]) => void;
  updateMCPConnected: (data: {
    servers: { name: string; online: boolean; toolCount: number }[];
    toolInfos: { name: string; source: string; description: string; online: boolean }[];
  }) => void;
  updateMCPStatus: (servers: { name: string; online: boolean; toolNames: string[] }[]) => void;

  prepareForSend: () => void;
  setShowPreparing: (v: boolean) => void;
};

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  toolGroupId: null,
  busy: false,
  showPreparing: false,
  tokenUsage: 0,
  todoItems: [],
  toolInfos: [],
  mcpServers: [],

  generateId: () => `msg-${Date.now()}-${++_counter}`,

  addMessage: (msg: Message) =>
    set(s => ({ messages: [...s.messages, msg] })),

  updateMessage: (id: string, patch: Partial<Message>) =>
    set(s => ({
      messages: s.messages.map(m => (m.id === id ? { ...m, ...patch } as Message : m)),
    })),

  clearMessages: () => set({ messages: [], toolGroupId: null }),

  handleDelta(delta: string, offset: number, reasoning?: string, thinkingDuration?: number) {
    set(s => {
      const last = s.messages[s.messages.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        return {
          showPreparing: false,
          messages: s.messages.map(m =>
            m.id === last.id
              ? { ...m, content: (m as Extract<Message, { role: "assistant" }>).content.substring(0, offset) + delta }
              : m
          ),
        };
      }
      const id = get().generateId();
      return {
        showPreparing: false,
        messages: [...s.messages, {
          role: "assistant",
          content: delta,
          id,
          streaming: true,
          timestamp: now(),
          ...(reasoning ? { reasoningContent: reasoning, thinkingDuration } : {}),
        } as Extract<Message, { role: "assistant" }>],
      };
    });
  },

  handleReason(_delta: string) {
    set({ showPreparing: false });
  },

  handleToolEvent(event: ToolEventParams): "created" | "updated" | null {
    const { toolGroupId, messages } = get();
    const callId = event.callId;
    const isResult = event.error !== undefined || event.result !== undefined;

    const groupIdx = toolGroupId
      ? messages.findIndex(m => m.role === "tool-group" && m.id === toolGroupId)
      : -1;

    if (groupIdx >= 0) {
      set(s => ({
        messages: s.messages.map((m, i) => {
          if (i !== groupIdx) return m;
          const group = m as Extract<Message, { role: "tool-group" }>;
          const existingIdx = group.entries.findIndex(e => e.toolCallId === callId);
          if (existingIdx >= 0) {
            const updated = [...group.entries];
            if (isResult) {
              updated[existingIdx] = {
                ...updated[existingIdx],
                phase: (event.error ? "error" : "done") as "error" | "done",
                detail: String(event.error ?? event.result ?? ""),
              };
            }
            return { ...group, entries: updated, collapsed: false };
          }
          return {
            ...group,
            collapsed: false,
            entries: [...group.entries, {
              toolCallId: callId,
              toolName: event.name,
              phase: isResult ? ((event.error ? "error" : "done") as "error" | "done") : ("executing" as const),
              input: event.input,
              detail: isResult ? String(event.error ?? event.result ?? "") : undefined,
            }],
          };
        }),
      }));

      if (event.name === "todowrite" && event.input) {
        const todos = (event.input as any)?.todos;
        if (Array.isArray(todos)) set({ todoItems: todos });
      }

      return "updated";
    }

    const newGroupId = get().generateId();
    set(s => ({
      toolGroupId: newGroupId,
      messages: [...s.messages, {
        role: "tool-group" as const,
        id: newGroupId,
        timestamp: now(),
        entries: [{
          toolCallId: callId,
          toolName: event.name,
          phase: isResult ? ((event.error ? "error" : "done") as "error" | "done") : ("executing" as const),
          input: event.input,
          detail: isResult ? String(event.error ?? event.result ?? "") : undefined,
        }],
        collapsed: false,
      }],
      showPreparing: false,
    }));

    if (event.name === "todowrite" && event.input) {
      const todos = (event.input as any)?.todos;
      if (Array.isArray(todos)) set({ todoItems: todos });
    }

    return "created";
  },

  handleToolStepFinish(_total: number, _success: number, _failed: number, _toolNames: string[]) {
    // Stats are accumulated via ToolGroupComplete from server
  },

  handleToolGroupComplete(total: number, success: number, failed: number, toolNames: string[]) {
    const { toolGroupId } = get();
    if (!toolGroupId) return;
    set(s => ({
      toolGroupId: null,
      messages: s.messages.map(m =>
        m.role === "tool-group" && m.id === toolGroupId
          ? { ...m, collapsed: true, summary: { total, success, failed, toolNames } }
          : m
      ),
    }));
  },

  setBusy: (busy: boolean) => set({ busy }),

  setTokenUsage: (total: number) => set({ tokenUsage: total }),

  setTodoItems: (todos: TodoItem[]) => set({ todoItems: todos }),

  setToolInfos: (infos: ToolInfo[]) => set({ toolInfos: infos }),

  updateMCPConnected(data) {
    set(s => ({
      mcpServers: data.servers.map(srv => ({ name: srv.name, online: srv.online, toolCount: srv.toolCount })),
      toolInfos: [
        ...s.toolInfos.filter(t => t.source !== "mcp"),
        ...data.toolInfos.map(t => ({ ...t, source: t.source as ToolInfo["source"] })),
      ],
    }));
  },

  updateMCPStatus(servers) {
    set(s => ({
      mcpServers: s.mcpServers.map(prev => {
        const updated = servers.find(ss => ss.name === prev.name);
        return updated ? { ...prev, online: updated.online } : prev;
      }),
    }));
  },

  prepareForSend() {
    set({
      toolGroupId: null,
      showPreparing: true,
      busy: true,
    });
  },

  setShowPreparing: (v: boolean) => set({ showPreparing: v }),
}));
