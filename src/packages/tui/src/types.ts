export type Message =
  | { role: "user"; content: string; id: string }
  | { role: "assistant"; content: string; id: string; streaming: boolean }
  | { role: "tool"; toolName: string; state: "running" | "done" | "error"; detail?: string; id: string }
  | { role: "error"; content: string; id: string };

export interface ServerInfo {
  port: number;
  host: string;
  model: string;
  sandbox: string;
  version: string;
  tools: string[];
}
