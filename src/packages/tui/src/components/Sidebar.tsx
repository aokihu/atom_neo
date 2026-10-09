import { useEffect, useRef, type ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useChatStore } from "../stores/chat";
import { useTheme } from "./App";
import { ScheduleBar } from "./ScheduleBar";
import { EmptyState } from "./EmptyState";

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

export function TelemetrySection({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
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

export function RoundsSection() {
  const { colors } = useTheme();
  const rounds = useChatStore(state => state.rounds);
  const online = useChatStore(state => state.telemetryOnline);
  const globalUsed = rounds?.completed ? 0 : rounds?.globalUsed ?? 0;
  const localUsed = rounds?.completed ? 0 : rounds?.localUsed ?? 0;
  const status = rounds?.pause === "health_check" ? "CHECKING"
    : rounds?.pause === "global_limit" ? "PAUSED · LIMIT"
      : rounds?.pause === "cancelled" ? "CANCELLED"
        : rounds?.pause === "interrupted" ? "PAUSED · INTERRUPTED"
          : rounds?.pause ? "PAUSED · REVIEW" : undefined;
  return <TelemetrySection title="ROUNDS" meta={online && rounds ? `${globalUsed} / ${rounds.globalAllowance}` : undefined}>
    {!online ? <text fg={colors.text.muted}>OFFLINE</text> : !rounds ? <EmptyState /> : <>
      <text fg={globalUsed / Math.max(rounds.globalAllowance, 1) >= 0.8 ? colors.status.warning : colors.status.success}>
        {buildGauge(globalUsed, rounds.globalAllowance, SIDEBAR_CONTENT_WIDTH)}
      </text>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={colors.text.muted}>WINDOW</text>
        <text fg={localUsed >= rounds.localLimit ? colors.status.warning : colors.text.secondary}>{`${localUsed} / ${rounds.localLimit}`}</text>
      </box>
      {status && <text fg={colors.status.warning}>{status}</text>}
      {rounds.pause === "global_limit" && <text fg={colors.text.secondary}>输入“继续”追加额度</text>}
    </>}
  </TelemetrySection>;
}

export function TodoSection() {
  const { colors } = useTheme();
  const items = useChatStore(state => state.todoItems);
  const online = useChatStore(state => state.telemetryOnline);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const active = items.findIndex(item => item.status === "in_progress");
  const activeKey = active < 0 ? undefined : `${active}:${items[active].content}`;
  const followPending = useRef(false);
  const scrolling = items.length > 5;
  useEffect(() => {
    followPending.current = true;
    scrollRef.current?.requestRender();
  }, [activeKey, scrolling]);
  useKeyboard(key => {
    if (!(key.meta || key.option) || key.ctrl || !scrolling) return;
    if (key.name === "up" || key.name === "down") scrollRef.current?.scrollBy(key.name === "up" ? -3 : 3);
  });
  const rows = items.map((item, index) => {
    const iconColor = item.status === "in_progress" ? colors.status.warning
      : item.status === "completed" ? colors.status.success
        : item.status === "cancelled" ? colors.status.error : colors.text.muted;
    return <box key={index} id={`todo-row-${index}`} flexDirection="row" gap={1} flexShrink={0}>
      <text fg={iconColor} flexShrink={0}>{TODO_ICON[item.status] ?? "?"}</text>
      <text flexGrow={1} flexShrink={1} fg={item.status === "in_progress" ? colors.text.secondary : colors.text.muted}>{item.content}</text>
    </box>;
  });
  return <TelemetrySection title="TODO" meta={active >= 0 ? `▶ ${active + 1} / ${items.length}` : `≡ ${items.length}`}>
    {!online ? <text fg={colors.text.muted}>OFFLINE</text> : items.length === 0 ? <EmptyState /> : <>
      <box flexDirection="row" gap={1}>
        <text fg={colors.status.success}>{`✅${items.filter(item => item.status === "completed").length}`}</text>
        <text fg={colors.text.muted}>{`⌛${items.filter(item => item.status === "pending").length}`}</text>
        <text fg={colors.status.warning}>{`▶${items.filter(item => item.status === "in_progress").length}`}</text>
        <text fg={colors.text.muted}>{`✕${items.filter(item => item.status === "cancelled").length}`}</text>
      </box>
      {scrolling ? <scrollbox id="todo-scroll" ref={scrollRef} height={15} flexShrink={0} scrollX={false}
        onSizeChange={() => { followPending.current = true; }}
        renderAfter={() => {
          if (!followPending.current) return;
          followPending.current = false;
          if (active >= 0) scrollRef.current?.scrollChildIntoView(`todo-row-${active}`);
        }}>
        {rows}
      </scrollbox> : rows}
    </>}
  </TelemetrySection>;
}

export function Sidebar({ contextLimit, url, adminToken }: { contextLimit: number; url: string; adminToken?: string }) {
  const { colors } = useTheme();
  const contextTokens = useChatStore(state => state.contextTokens);
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

      <RoundsSection />
      <ScheduleBar url={url} adminToken={adminToken} />

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
          ? <EmptyState />
          : mcpServers.slice(0, 4).map(server => (
            <box key={server.name} flexDirection="row" justifyContent="space-between">
              <text fg={colors.text.muted}>{server.name}</text>
              <text fg={server.online ? colors.text.muted : colors.status.error}>
                {server.online ? "ONLINE" : "OFFLINE"}
              </text>
            </box>
          ))}
      </TelemetrySection>

      <TodoSection />

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
