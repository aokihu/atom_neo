export type ThemeColors = {
  bg: { page: string; codeBlock: string; input: string };
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

export type Message =
  | { role: "user"; content: string; id: string }
  | { role: "assistant"; content: string; id: string; streaming: boolean }
  | { role: "thinking"; id: string }
  | { role: "tool"; toolName: string; state: "running" | "done" | "error"; detail?: string; id: string }
  | { role: "error"; content: string; id: string };

export interface ServerInfo {
  port: number;
  host: string;
  model: string;
  sandbox: string;
  version: string;
  tools: string[];
  theme?: ThemeName;
  contextLimit?: number;
}
