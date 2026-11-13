import type { StateCreator } from "zustand";
import { estimateReceivedTokens } from "../../components/format";
import type { Message } from "../../types";
import type { ChatState, StreamSlice } from "./types";

export const createStreamSlice: StateCreator<ChatState, [], [], StreamSlice> = (set, get) => ({
  busy: false,
  showPreparing: false,
  activeAssistantId: null,
  streamReceivedChars: 0,
  streamChunkCount: 0,
  streamTokenBatches: [],

  handleDelta(delta: string, offset: number, reasoning?: string, thinkingDuration?: number) {
    get().recordStreamChunk(delta);
    set(s => {
      if (s.activeAssistantId) {
        return {
          showPreparing: false,
          messages: s.messages.map(m =>
            m.id === s.activeAssistantId
              ? { ...m, content: (m as Extract<Message, { role: "assistant" }>).content.substring(0, offset) + delta }
              : m
          ),
        };
      }
      const id = get().generateId();
      return {
        showPreparing: false,
        activeAssistantId: id,
        messages: [...s.messages, {
          role: "assistant",
          content: delta,
          id,
          streaming: true,
          timestamp: Date.now(),
          ...(reasoning ? { reasoningContent: reasoning, thinkingDuration } : {}),
        } as Extract<Message, { role: "assistant" }>],
      };
    });
  },

  handleReason(delta: string) {
    get().recordStreamChunk(delta);
    set({ showPreparing: false });
  },

  recordStreamChunk(text: string) {
    if (!text) return;
    set(s => ({
      streamReceivedChars: s.streamReceivedChars + text.length,
      streamChunkCount: s.streamChunkCount + 1,
      streamTokenBatches: [...s.streamTokenBatches, estimateReceivedTokens(text.length)].slice(-8),
    }));
  },

  setBusy: (busy: boolean) => set(s => {
    if (busy) return { busy };
    return {
      busy: false,
      showPreparing: false,
      activeAssistantId: null,
      messages: s.messages.map(m =>
        m.role === "assistant" && m.streaming ? { ...m, streaming: false } : m),
    };
  }),

  prepareForSend() {
    set({
      toolGroupId: null,
      activeAssistantId: null,
      showPreparing: true,
      busy: true,
      streamReceivedChars: 0,
      streamChunkCount: 0,
      streamTokenBatches: [],
      predictionDecision: null,
      postDecision: null,
    });
  },

  setShowPreparing: (v: boolean) => set({ showPreparing: v }),
});
