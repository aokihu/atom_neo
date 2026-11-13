import type { StateCreator } from "zustand";
import type { Message } from "../../types";
import type { ChatState, MessageSlice } from "./types";

let _counter = 0;

export const createMessageSlice: StateCreator<ChatState, [], [], MessageSlice> = (set) => ({
  messages: [],

  generateId: () => `msg-${Date.now()}-${++_counter}`,

  addMessage: (msg: Message) =>
    set(s => ({ messages: [...s.messages, msg] })),

  addTransientMessage: (msg: Message, durationMs: number) => {
    set(s => ({ messages: [...s.messages, msg] }));
    setTimeout(() => {
      set(s => ({ messages: s.messages.filter(item => item.id !== msg.id) }));
    }, durationMs);
  },

  updateMessage: (id: string, patch: Partial<Message>) =>
    set(s => ({
      messages: s.messages.map(m => (m.id === id ? { ...m, ...patch } as Message : m)),
    })),

  clearMessages: () => set({
    messages: [],
    toolGroupId: null,
    activeAssistantId: null,
    streamReceivedChars: 0,
    streamChunkCount: 0,
    streamTokenBatches: [],
    predictionDecision: null,
    postDecision: null,
  }),
});
