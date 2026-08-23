import { createContext, useContext } from "react";

export type ThemeColors = {
  bg: { page: string; codeBlock: string; input: string; popup: string };
  border: { default: string };
  decoration: { subtle: string };
  text: { muted: string; secondary: string; primary: string; bright: string; medium: string };
  accent: { brand: string };
  status: { success: string; warning: string; error: string };
};

export const THEMES: Record<string, ThemeColors> = {
  "edex": {
    bg:    { page: "#05090c", codeBlock: "#081218", input: "#081218", popup: "#0c1b22" },
    border:{ default: "#376c7b" },
    decoration:{ subtle: "#16313a" },
    text:  { muted: "#4a626c", secondary: "#8196a0", primary: "#d6e0e5", bright: "#e8f2f5", medium: "#a8bec6" },
    accent:{ brand: "#63cbea" },
    status:{ success: "#73d65c", warning: "#f5c451", error: "#ef6b73" },
  },
  "github-dark": {
    bg:    { page: "#0d1117", codeBlock: "#161b22", input: "#1c2128", popup: "#252b33" },
    border:{ default: "#21262d" },
    decoration:{ subtle: "#30363d" },
    text:  { muted: "#484f58", secondary: "#8b949e", primary: "#e6edf3", bright: "#f0f6fc", medium: "#c9d1d9" },
    accent:{ brand: "#58a6ff" },
    status:{ success: "#3fb950", warning: "#d29922", error: "#f85149" },
  },
  "github-light": {
    bg:    { page: "#ffffff", codeBlock: "#f6f8fa", input: "#f6f8fa", popup: "#eaeef2" },
    border:{ default: "#d0d7de" },
    decoration:{ subtle: "#d8dee4" },
    text:  { muted: "#656d76", secondary: "#57606a", primary: "#1f2328", bright: "#0d1117", medium: "#636c76" },
    accent:{ brand: "#0969da" },
    status:{ success: "#1a7f37", warning: "#9a6700", error: "#cf222e" },
  },
  "dracula": {
    bg:    { page: "#282a36", codeBlock: "#1e1f29", input: "#313244", popup: "#3b3d54" },
    border:{ default: "#44475a" },
    decoration:{ subtle: "#44475a" },
    text:  { muted: "#6272a4", secondary: "#888ca6", primary: "#f8f8f2", bright: "#ffffff", medium: "#bfbfbf" },
    accent:{ brand: "#bd93f9" },
    status:{ success: "#50fa7b", warning: "#f1fa8c", error: "#ff5555" },
  },
  "nord": {
    bg:    { page: "#2e3440", codeBlock: "#3b4252", input: "#3b4252", popup: "#444c5e" },
    border:{ default: "#4c566a" },
    decoration:{ subtle: "#4c566a" },
    text:  { muted: "#616e88", secondary: "#81a1c1", primary: "#d8dee9", bright: "#eceff4", medium: "#a3be8c" },
    accent:{ brand: "#88c0d0" },
    status:{ success: "#a3be8c", warning: "#ebcb8b", error: "#bf616a" },
  },
  "tokyo-night": {
    bg:    { page: "#1a1b26", codeBlock: "#24283b", input: "#1f2335", popup: "#282d45" },
    border:{ default: "#292e42" },
    decoration:{ subtle: "#3b4261" },
    text:  { muted: "#565f89", secondary: "#9aa5ce", primary: "#c0caf5", bright: "#e0e7ff", medium: "#a9b1d6" },
    accent:{ brand: "#7aa2f7" },
    status:{ success: "#9ece6a", warning: "#e0af68", error: "#f7768e" },
  },
  "solarized-dark": {
    bg:    { page: "#002b36", codeBlock: "#073642", input: "#073642", popup: "#0e4150" },
    border:{ default: "#586e75" },
    decoration:{ subtle: "#586e75" },
    text:  { muted: "#657b83", secondary: "#839496", primary: "#93a1a1", bright: "#eee8d5", medium: "#839496" },
    accent:{ brand: "#268bd2" },
    status:{ success: "#859900", warning: "#b58900", error: "#dc322f" },
  },
  "monokai": {
    bg:    { page: "#272822", codeBlock: "#1e1f1c", input: "#3e3d32", popup: "#48473c" },
    border:{ default: "#49483e" },
    decoration:{ subtle: "#49483e" },
    text:  { muted: "#75715e", secondary: "#a59f85", primary: "#f8f8f2", bright: "#ffffff", medium: "#cfcfc2" },
    accent:{ brand: "#a6e22e" },
    status:{ success: "#a6e22e", warning: "#e6db74", error: "#f92672" },
  },
};

export function getThemeColors(name: string): ThemeColors {
  return THEMES[name] ?? THEMES.edex;
}

type ThemeCtx = { colors: ThemeColors };

const ThemeContext = createContext<ThemeCtx>({ colors: THEMES.edex });

export function ThemeProvider({ theme, children }: { theme: string; children: React.ReactNode }) {
  const value = { colors: getThemeColors(theme) };
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(ThemeContext);
}
