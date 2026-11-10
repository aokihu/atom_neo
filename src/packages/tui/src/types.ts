import type { ThemeName } from "@atom-neo/shared";

export type { ThemeName };

export type ThemeColors = {
  bg: { page: string; codeBlock: string; input: string; popup: string };
  border: { default: string };
  decoration: { subtle: string };
  text: { muted: string; secondary: string; primary: string; bright: string; medium: string };
  accent: { brand: string };
  code: { red: string; cyan: string; blue: { light: string }; purple: string; orange: string };
  status: { success: string; warning: string; error: string };
};

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
  | { role: "assistant"; content: string; id: string; streaming: boolean; timestamp: number; reasoningContent?: string; thinkingDuration?: number }
  | { role: "tool-group"; id: string; timestamp: number; entries: ToolEntry[]; collapsed: boolean; summary?: ToolSummary }
  | { role: "error"; content: string; id: string; timestamp: number }
  | { role: "info"; content: string; id: string; timestamp: number };

export type { TodoItem } from "@atom-neo/shared";

export type ToolGroupMessage = Extract<Message, { role: "tool-group" }>;

export type ToolInfo = {
  name: string;
  source: "builtin" | "plugin" | "mcp";
  description?: string;
  online?: boolean;
};

export type MCPServerInfo = {
  name: string;
  online: boolean;
  toolCount: number;
};

export interface ServerInfo {
  port: number;
  host: string;
  model: string;
  sandbox: string;
  version: string;
  tools: string[];
  toolInfos?: ToolInfo[];
  mcpServerInfos?: MCPServerInfo[];
  theme?: ThemeName;
  contextLimit?: number;
  thinking?: "enabled" | "disabled" | "adaptive";
}
