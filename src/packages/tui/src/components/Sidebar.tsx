import type { ReactNode } from "react";
import { useChatStore } from "../stores/chat";
import { useTheme } from "./App";

export const SIDEBAR_WIDTH = 30;
export const SIDEBAR_CONTENT_WIDTH = SIDEBAR_WIDTH - 3;

export function buildGauge(used: number, limit: number, width: number): string {
  const ratio = Math.min(used / Math.max(limit, 1), 1);
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pct(used: number, limit: number): string {
  return Math.round((used / Math.max(limit, 1)) * 100) + "%";
}

const TODO_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
  cancelled: "✕",
};

function TelemetrySection({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      marginBottom={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={colors.text.muted}>{title}</text>
        {meta && <text fg={colors.text.muted}>{meta}</text>}
      </box>
      {children}
    </box>
  );
}
export function Sidebar({ contextLimit }: { contextLimit: number }) {
  const { colors } = useTheme();
  const contextTokens = useChatStore(state => state.contextTokens);
  const todoItems = useChatStore(state => state.todoItems);
  const toolInfos = useChatStore(state => state.toolInfos);
  const mcpServers = useChatStore(state => state.mcpServers);
  const messages = useChatStore(state => state.messages);

  const ratio = Math.round((contextTokens / Math.max(contextLimit, 1)) * 100);
  const entries = messages.flatMap(message => message.role === "tool-group" ? message.entries : []);
  const runningTools = entries.filter(entry => entry.phase === "preparing" || entry.phase === "executing").length;
  const webFetches = entries.filter(entry => entry.toolName.toLowerCase() === "webfetch");
  const webSuccess = webFetches.filter(entry => entry.phase === "done").length;
  const webFailed = webFetches.filter(entry => entry.phase === "error").length;
  const mcpOnline = mcpServers.filter(server => server.online).length;
  const builtinCount = toolInfos.filter(tool => tool.source === "builtin").length;
  const toolState = (phase: (typeof entries)[number]["phase"]) => (
    phase === "preparing" || phase === "executing" ? "RUN" : phase === "done" ? "OK" : "ERR"
  );

  return (
    <box
      width={SIDEBAR_WIDTH}
      flexShrink={0}
      flexDirection="column"
      border={["left"]}
      borderColor={colors.decoration.subtle}
      borderStyle="single"
      overflow="hidden"
      backgroundColor={colors.bg.page}
    >
      <TelemetrySection title="CONTEXT" meta={pct(contextTokens, contextLimit)}>
        <text fg={ratio > 90 ? colors.status.error : ratio > 75 ? colors.status.warning : colors.status.success}>
          {buildGauge(contextTokens, contextLimit, SIDEBAR_CONTENT_WIDTH)}
        </text>
        <text fg={colors.text.secondary}>{`${contextTokens.toLocaleString()} / ${contextLimit.toLocaleString()}`}</text>
      </TelemetrySection>

      <TelemetrySection title="TOOLS" meta={`${runningTools} RUN`}>
        {entries.length === 0
          ? (
            <>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={colors.text.muted}>BUILTIN</text>
                <text fg={colors.text.muted}>{builtinCount}</text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={colors.text.muted}>MCP</text>
                <text fg={colors.text.muted}>{toolInfos.filter(tool => tool.source === "mcp").length}</text>
              </box>
            </>
          )
          : entries.slice(-3).map(entry => {
            const state = toolState(entry.phase);
            const stateColor = state === "ERR" ? colors.status.error
              : state === "RUN" ? colors.status.warning
                : colors.text.muted;
            return (
              <box key={entry.toolCallId} flexDirection="row" justifyContent="space-between">
                <text fg={state === "RUN" ? colors.text.secondary : colors.text.muted}>{entry.toolName}</text>
                <text fg={stateColor}>{state}</text>
              </box>
            );
          })}
      </TelemetrySection>

      <TelemetrySection title="MCP" meta={`${mcpOnline}/${mcpServers.length}`}>
        {mcpServers.length === 0
          ? <text fg={colors.text.muted}>EMPTY</text>
          : mcpServers.slice(0, 4).map(server => (
            <box key={server.name} flexDirection="row" justifyContent="space-between">
              <text fg={colors.text.muted}>{server.name}</text>
              <text fg={server.online ? colors.text.muted : colors.status.error}>
                {server.online ? "ONLINE" : "OFFLINE"}
              </text>
            </box>
          ))}
      </TelemetrySection>

      <TelemetrySection title="TODO" meta={String(todoItems.length)}>
        {todoItems.length === 0
          ? <text fg={colors.text.muted}>EMPTY</text>
          : todoItems.slice(0, 5).map((item, index) => {
            const iconColor = item.status === "in_progress" ? colors.status.warning
              : item.status === "completed" ? colors.status.success
                : item.status === "cancelled" ? colors.status.error
                  : colors.text.muted;
            return (
              <box key={`${item.content}-${index}`} flexDirection="row" gap={1}>
                <text fg={iconColor}>{TODO_ICON[item.status] ?? "?"}</text>
                <text fg={item.status === "in_progress" ? colors.text.secondary : colors.text.muted}>
                  {item.content}
                </text>
              </box>
            );
          })}
      </TelemetrySection>

      <TelemetrySection title="NETWORK" meta="SESSION">
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>WEBFETCH</text>
          <text fg={colors.text.muted}>{webFetches.length}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>SUCCESS</text>
          <text fg={colors.text.muted}>{webSuccess}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>FAILED</text>
          <text fg={webFailed > 0 ? colors.status.error : colors.text.muted}>{webFailed}</text>
        </box>
      </TelemetrySection>
    </box>
  );
}
