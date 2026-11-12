import type { Message, ToolEntry, ToolInfo, ToolPhase } from "../../types";

export const SIDEBAR_WIDTH = 30;
export const SIDEBAR_CONTENT_WIDTH = SIDEBAR_WIDTH - 3;

export function buildGauge(used: number, limit: number, width: number): string {
  const ratio = Math.min(used / Math.max(limit, 1), 1);
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function pct(used: number, limit: number): string {
  return Math.round((used / Math.max(limit, 1)) * 100) + "%";
}

export function toolEntries(messages: Message[]): ToolEntry[] {
  return messages.flatMap(message => message.role === "tool-group" ? message.entries : []);
}

export function toolState(phase: ToolPhase): "RUN" | "OK" | "ERR" {
  return phase === "preparing" || phase === "executing" ? "RUN" : phase === "done" ? "OK" : "ERR";
}

export function summarizeTools(messages: Message[], toolInfos: ToolInfo[]) {
  const entries = toolEntries(messages);
  return {
    entries,
    running: entries.filter(entry => entry.phase === "preparing" || entry.phase === "executing").length,
    builtin: toolInfos.filter(tool => tool.source === "builtin").length,
    mcp: toolInfos.filter(tool => tool.source === "mcp").length,
  };
}

export function summarizeNetwork(messages: Message[]) {
  const webFetches = toolEntries(messages).filter(entry => entry.toolName.toLowerCase() === "webfetch");
  return {
    fetched: webFetches.length,
    success: webFetches.filter(entry => entry.phase === "done").length,
    failed: webFetches.filter(entry => entry.phase === "error").length,
  };
}
