import type { StateCreator } from "zustand";
import type { Message } from "../../types";
import type { ChatState, ToolEventParams, ToolSlice } from "./types";

export const createToolSlice: StateCreator<ChatState, [], [], ToolSlice> = (set, get) => ({
  toolGroupId: null,

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
      return "updated";
    }

    const newGroupId = get().generateId();
    set(s => {
      const updatedMessages = s.activeAssistantId
        ? s.messages.map(m =>
            m.id === s.activeAssistantId && m.role === "assistant"
              ? { ...m, streaming: false }
              : m)
        : s.messages;
      return {
        toolGroupId: newGroupId,
        messages: [...updatedMessages, {
          role: "tool-group" as const,
          id: newGroupId,
          timestamp: Date.now(),
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
      };
    });

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
});
