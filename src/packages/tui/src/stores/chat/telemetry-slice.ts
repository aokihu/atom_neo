import type { StateCreator } from "zustand";
import type { TodoItem, ToolInfo } from "../../types";
import type { ChatState, TelemetrySlice } from "./types";

export const createTelemetrySlice: StateCreator<ChatState, [], [], TelemetrySlice> = (set) => ({
  contextTokens: 0,
  todoItems: [],
  rounds: null,
  telemetryOnline: false,
  toolInfos: [],
  mcpServers: [],
  predictionDecision: null,
  postDecision: null,

  setContextTokens: (total: number) => set({ contextTokens: total }),

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

  setDecisionUpdate(update) {
    set(update.purpose === "prediction" ? { predictionDecision: update } : { postDecision: update });
  },
});
