import { create } from "zustand";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const MAX_HISTORY = 100;
let _file = "";

function save(history: string[]) {
  if (!_file) return;
  try { writeFileSync(_file, JSON.stringify(history), "utf-8"); } catch {}
}

function load(): string[] {
  if (!_file) return [];
  try { return JSON.parse(readFileSync(_file, "utf-8")); } catch { return []; }
}

type InputHistoryState = {
  history: string[];
  historyIndex: number;
  draft: string;
  init: (sandbox: string) => void;
  push: (text: string) => void;
  navigateUp: () => { prev: string; idx: number };
  navigateDown: () => { text: string; idx: number } | null;
  resetIndex: () => void;
  setDraft: (text: string) => void;
};

export const useInputHistory = create<InputHistoryState>((set, get) => ({
  history: [],
  historyIndex: -1,
  draft: "",

  init: (sandbox: string) => {
    const dir = join(sandbox, ".atom");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    _file = join(dir, "tui_history");
    const saved = load();
    if (saved.length > 0) set({ history: saved });
  },

  push: (text: string) =>
    set((s) => {
      const history =
        s.history.length > 0 && s.history[0] === text
          ? s.history
          : [text, ...s.history].slice(0, MAX_HISTORY);
      save(history);
      return { history, historyIndex: -1 };
    }),

  navigateUp: () => {
    const { history, historyIndex } = get();
    if (history.length === 0) return { prev: "", idx: -1 };
    const idx = historyIndex === -1 ? 0 : Math.min(historyIndex + 1, history.length - 1);
    set({ historyIndex: idx });
    return { prev: history[idx], idx };
  },

  navigateDown: () => {
    const { history, historyIndex } = get();
    if (history.length === 0) return null;
    if (historyIndex <= 0) {
      set({ historyIndex: -1 });
      return null;
    }
    const idx = historyIndex - 1;
    set({ historyIndex: idx });
    return { text: history[idx], idx };
  },

  resetIndex: () => set({ historyIndex: -1 }),

  setDraft: (text: string) => set({ draft: text }),
}));
