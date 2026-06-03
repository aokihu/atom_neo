import { create } from "zustand";

type CopiedState = {
  copied: boolean;
  setCopied: (v: boolean) => void;
};

export const useCopied = create<CopiedState>((set) => ({
  copied: false,
  setCopied: (v) => set({ copied: v }),
}));
