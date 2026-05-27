import { SyntaxStyle, RGBA } from "@opentui/core";
import type { ThemeColors, ThemeName } from "./types";

export const THEMES: Record<ThemeName, ThemeColors> = {
  "github-dark": {
    bg:    { page: "#0d1117", codeBlock: "#161b22", input: "#1c2128" },
    border:{ default: "#21262d" },
    decoration:{ subtle: "#30363d" },
    text:  { muted: "#484f58", secondary: "#8b949e", primary: "#e6edf3", bright: "#f0f6fc", medium: "#c9d1d9" },
    accent:{ brand: "#58a6ff" },
    code:  { red: "#ff7b72", cyan: "#a5d6ff", blue:{ light: "#79c0ff" }, purple: "#d2a8ff", orange: "#ffa657" },
    status:{ success: "#3fb950", warning: "#d29922", error: "#f85149" },
  },
  "github-light": {
    bg:    { page: "#ffffff", codeBlock: "#f6f8fa", input: "#f6f8fa" },
    border:{ default: "#d0d7de" },
    decoration:{ subtle: "#d8dee4" },
    text:  { muted: "#656d76", secondary: "#57606a", primary: "#1f2328", bright: "#0d1117", medium: "#636c76" },
    accent:{ brand: "#0969da" },
    code:  { red: "#cf222e", cyan: "#0a3069", blue:{ light: "#0550ae" }, purple: "#8250df", orange: "#953800" },
    status:{ success: "#1a7f37", warning: "#9a6700", error: "#cf222e" },
  },
  "dracula": {
    bg:    { page: "#282a36", codeBlock: "#1e1f29", input: "#313244" },
    border:{ default: "#44475a" },
    decoration:{ subtle: "#44475a" },
    text:  { muted: "#6272a4", secondary: "#888ca6", primary: "#f8f8f2", bright: "#ffffff", medium: "#bfbfbf" },
    accent:{ brand: "#bd93f9" },
    code:  { red: "#ff5555", cyan: "#8be9fd", blue:{ light: "#8be9fd" }, purple: "#bd93f9", orange: "#ffb86c" },
    status:{ success: "#50fa7b", warning: "#f1fa8c", error: "#ff5555" },
  },
  "nord": {
    bg:    { page: "#2e3440", codeBlock: "#3b4252", input: "#3b4252" },
    border:{ default: "#4c566a" },
    decoration:{ subtle: "#4c566a" },
    text:  { muted: "#616e88", secondary: "#81a1c1", primary: "#d8dee9", bright: "#eceff4", medium: "#a3be8c" },
    accent:{ brand: "#88c0d0" },
    code:  { red: "#bf616a", cyan: "#88c0d0", blue:{ light: "#81a1c1" }, purple: "#b48ead", orange: "#d08770" },
    status:{ success: "#a3be8c", warning: "#ebcb8b", error: "#bf616a" },
  },
  "tokyo-night": {
    bg:    { page: "#1a1b26", codeBlock: "#24283b", input: "#1f2335" },
    border:{ default: "#292e42" },
    decoration:{ subtle: "#3b4261" },
    text:  { muted: "#565f89", secondary: "#9aa5ce", primary: "#c0caf5", bright: "#e0e7ff", medium: "#a9b1d6" },
    accent:{ brand: "#7aa2f7" },
    code:  { red: "#f7768e", cyan: "#7dcfff", blue:{ light: "#7aa2f7" }, purple: "#bb9af7", orange: "#ff9e64" },
    status:{ success: "#9ece6a", warning: "#e0af68", error: "#f7768e" },
  },
  "solarized-dark": {
    bg:    { page: "#002b36", codeBlock: "#073642", input: "#073642" },
    border:{ default: "#586e75" },
    decoration:{ subtle: "#586e75" },
    text:  { muted: "#657b83", secondary: "#839496", primary: "#93a1a1", bright: "#eee8d5", medium: "#839496" },
    accent:{ brand: "#268bd2" },
    code:  { red: "#dc322f", cyan: "#2aa198", blue:{ light: "#268bd2" }, purple: "#6c71c4", orange: "#cb4b16" },
    status:{ success: "#859900", warning: "#b58900", error: "#dc322f" },
  },
  "monokai": {
    bg:    { page: "#272822", codeBlock: "#1e1f1c", input: "#3e3d32" },
    border:{ default: "#49483e" },
    decoration:{ subtle: "#49483e" },
    text:  { muted: "#75715e", secondary: "#a59f85", primary: "#f8f8f2", bright: "#ffffff", medium: "#cfcfc2" },
    accent:{ brand: "#a6e22e" },
    code:  { red: "#f92672", cyan: "#66d9ef", blue:{ light: "#66d9ef" }, purple: "#ae81ff", orange: "#fd971f" },
    status:{ success: "#a6e22e", warning: "#e6db74", error: "#f92672" },
  },
};

export function getTheme(name: ThemeName = "github-dark"): { colors: ThemeColors; syntaxStyle: SyntaxStyle } {
  const c = THEMES[name] ?? THEMES["github-dark"];
  return { colors: c, syntaxStyle: buildSyntaxStyle(c) };
}

function c(hex: string) { return RGBA.fromHex(hex); }

function buildSyntaxStyle(t: ThemeColors): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    "markup.heading.1":    { fg: c(t.accent.brand), bold: true },
    "markup.heading.2":    { fg: c(t.accent.brand), bold: true },
    "markup.heading.3":    { fg: c(t.code.blue.light), bold: true },
    "markup.heading":      { fg: c(t.accent.brand), bold: true },
    "markup.bold":         { fg: c(t.text.primary), bold: true },
    "markup.strong":       { fg: c(t.text.primary), bold: true },
    "markup.italic":       { fg: c(t.text.primary), italic: true },
    "markup.list":         { fg: c(t.text.primary) },
    "markup.quote":        { fg: c(t.text.secondary), italic: true },
    "markup.raw":          { fg: c(t.code.cyan), bg: c(t.bg.codeBlock) },
    "markup.raw.block":    { fg: c(t.text.primary) },
    "markup.link":         { fg: c(t.accent.brand), underline: true },
    "markup.link.url":     { fg: c(t.accent.brand), underline: true },
    "markup.link.label":   { fg: c(t.accent.brand) },
    keyword:               { fg: c(t.code.red), bold: true },
    "keyword.import":      { fg: c(t.code.red), bold: true },
    "keyword.operator":    { fg: c(t.code.red) },
    string:                { fg: c(t.code.cyan) },
    comment:               { fg: c(t.text.secondary), italic: true },
    number:                { fg: c(t.code.blue.light) },
    boolean:               { fg: c(t.code.blue.light) },
    constant:              { fg: c(t.code.blue.light) },
    function:              { fg: c(t.code.purple) },
    "function.call":        { fg: c(t.code.purple) },
    "function.method.call": { fg: c(t.code.purple) },
    type:                  { fg: c(t.code.orange) },
    constructor:           { fg: c(t.code.orange) },
    variable:              { fg: c(t.text.primary) },
    "variable.member":     { fg: c(t.code.blue.light) },
    property:              { fg: c(t.code.blue.light) },
    operator:              { fg: c(t.code.red) },
    punctuation:           { fg: c(t.text.bright) },
    "punctuation.bracket": { fg: c(t.text.bright) },
    "punctuation.delimiter": { fg: c(t.text.medium) },
    default:               { fg: c(t.text.primary) },
  });
}
