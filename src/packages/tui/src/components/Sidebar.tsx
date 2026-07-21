import { useState, useEffect, useRef } from "react";
import type { ServerInfo } from "../types";
import { useTheme } from "./App";
import { useChatStore } from "../stores/chat";

function gauge(used: number, limit: number, width = 10): string {
  const r = Math.min(used / Math.max(limit, 1), 1);
  const f = Math.round(r * width);
  return '█'.repeat(f) + '░'.repeat(width - f);
}

function pct(used: number, limit: number): string {
  return Math.round((used / Math.max(limit, 1)) * 100) + '%';
}

const STATUS_ICON: Record<string, string> = {
  pending: '☐',
  in_progress: '◐',
  completed: '✓',
  cancelled: '✕',
};

interface SidebarProps {
  serverInfo: ServerInfo;
  contextLimit: number;
}

function fmtUptime(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`;

  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);

  let result = '';
  if (d > 0) result += `${d}d`;
  if (h > 0) result += `${h}h`;
  result += `${m}m`;
  return result;
}

export function Sidebar({ serverInfo, contextLimit }: SidebarProps) {
  const { colors } = useTheme();
  const [uptime, setUptime] = useState(0);
  const startRef = useRef(Date.now());
  const [mcpExpanded, setMcpExpanded] = useState(false);
  const contextTokens = useChatStore(s => s.contextTokens);
  const todoItems = useChatStore(s => s.todoItems);
  const toolInfos = useChatStore(s => s.toolInfos);
  const mcpServers = useChatStore(s => s.mcpServers);

  useEffect(() => {
    const interval = uptime < 60 ? 1000 : 60_000;
    const t = setInterval(() => {
      setUptime(Math.floor((Date.now() - startRef.current) / 1000));
    }, interval);
    return () => clearInterval(t);
  }, [uptime < 60]);

  const ratio = Math.round((contextTokens / Math.max(contextLimit, 1)) * 100);
  const builtinCount = toolInfos.filter(t => t.source === "builtin").length;
  const mcpTotal = mcpServers.length;
  const mcpOnline = mcpServers.filter(s => s.online).length;

  return (
    <box flexShrink={0} minWidth={24} width="28%" paddingLeft={1} paddingRight={1} paddingTop={1} flexDirection="column" gap={2}>
      {/* Server block */}
      <box flexDirection="column">
        <text>
          <strong fg={colors.accent.brand}>Server</strong>
        </text>
        <box backgroundColor={colors.bg.codeBlock} padding={1} flexDirection="column">
          <box flexDirection="row">
            <text fg={colors.text.muted} width={7}>Uptime</text>
            <text fg={colors.text.secondary}>{fmtUptime(uptime)}</text>
          </box>
          <box flexDirection="row">
            <text fg={colors.text.muted} width={7}>Tools</text>
            <text fg={colors.text.secondary}>{`${builtinCount} builtin`}</text>
          </box>
          <box flexDirection="row">
            <text fg={colors.text.muted} width={7}>Context</text>
            <text fg={ratio > 90 ? colors.status.error : ratio > 75 ? colors.status.warning : colors.status.success}>
              {gauge(contextTokens, contextLimit)}
            </text>
            <text fg={colors.text.secondary}> {pct(contextTokens, contextLimit)}</text>
          </box>
        </box>
      </box>

      {/* MCP Servers block */}
      {mcpServers.length > 0 && (
        <box flexDirection="column" onMouseUp={() => setMcpExpanded(!mcpExpanded)}>
          <box flexDirection="row" gap={0}>
            <text>
              <strong fg={colors.accent.brand}>MCP Tools</strong>
            </text>
            <text fg={colors.text.muted}>{` (${mcpOnline}/${mcpTotal})`}</text>
            <text fg={colors.text.muted}>{mcpExpanded ? ' ▲' : ' ▼'}</text>
          </box>
          {mcpExpanded && (
            <box backgroundColor={colors.bg.codeBlock} padding={1} flexDirection="column" gap={1}>
              {mcpServers.map((s, i) => (
                <box key={i} flexDirection="row" gap={1}>
                  <text fg={s.online ? colors.status.success : colors.text.muted}>{s.online ? '●' : '○'}</text>
                  <text fg={s.online ? colors.text.primary : colors.text.muted}>{s.name}</text>
                </box>
              ))}
            </box>
          )}
        </box>
      )}

      {/* TODO block */}
      {todoItems.length > 0 && (
        <box flexDirection="column">
          <text>
            <strong fg={colors.accent.brand}>TODO</strong>
          </text>
          <box backgroundColor={colors.bg.codeBlock} padding={1} flexDirection="column" gap={1}>
            {todoItems.map((item, i) => {
              const icon = STATUS_ICON[item.status] ?? '?';
              const iconColor = item.status === 'in_progress' ? colors.status.warning
                : item.status === 'completed' ? colors.status.success
                : item.status === 'cancelled' ? colors.status.error
                : colors.text.muted;
              const textColor = item.status === 'in_progress' ? colors.text.primary
                : item.status === 'completed' || item.status === 'cancelled' ? colors.text.muted
                : colors.text.secondary;
              return (
                <box key={i} flexDirection="row" gap={1}>
                  <text fg={iconColor}>{icon}</text>
                  <text fg={textColor}>{item.content}</text>
                </box>
              );
            })}
          </box>
        </box>
      )}
    </box>
  );
}
