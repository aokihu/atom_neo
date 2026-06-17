export type ThemeColors = {
  bg: { page: string; codeBlock: string; input: string; popup: string };
  border: { default: string };
  decoration: { subtle: string };
  text: { muted: string; secondary: string; primary: string; bright: string; medium: string };
  accent: { brand: string };
  code: { red: string; cyan: string; blue: { light: string }; purple: string; orange: string };
  status: { success: string; warning: string; error: string };
};

export type ThemeName =
  | "github-dark"
  | "github-light"
  | "dracula"
  | "nord"
  | "tokyo-night"
  | "solarized-dark"
  | "monokai";

export type ToolPhase = "preparing" | "executing" | "done" | "error";

export type ToolEntry = {
  toolCallId: string;
  toolName: string;
  phase: ToolPhase;
  input?: unknown;
  detail?: string;
};

export type ToolSummary = {
  total: number;
  success: number;
  failed: number;
  toolNames: string[];
};

export type Message =
  | { role: "user"; content: string; id: string; timestamp: number }
  | { role: "assistant"; content: string; id: string; streaming: boolean; timestamp: number }
  | { role: "thinking"; id: string; timestamp: number }
  | { role: "tool-group"; id: string; timestamp: number; entries: ToolEntry[]; collapsed: boolean; summary?: ToolSummary }
  | { role: "error"; content: string; id: string; timestamp: number }
  | { role: "info"; content: string; id: string; timestamp: number };

export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
};

export interface ServerInfo {
  port: number;
  host: string;
  model: string;
  sandbox: string;
  version: string;
  tools: string[];
  theme?: ThemeName;
  contextLimit?: number;
  thinking?: "enabled" | "disabled" | "adaptive";
}
