import { useState, useEffect, useRef } from "react";
import type { ServerInfo, TodoItem } from "../types";
import { useTheme } from "./App";

function gauge(used: number, limit: number, width = 20): string {
  const r = Math.min(used / Math.max(limit, 1), 1);
  const f = Math.round(r * width);
  return '█'.repeat(f) + '░'.repeat(width - f);
}

function fmtK(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
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
  tokenUsage: number;
  contextLimit: number;
  todoItems: TodoItem[];
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

export function Sidebar({ serverInfo, tokenUsage, contextLimit, todoItems }: SidebarProps) {
  const { colors } = useTheme();
  const [uptime, setUptime] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const interval = uptime < 60 ? 1000 : 60_000;
    const t = setInterval(() => {
      setUptime(Math.floor((Date.now() - startRef.current) / 1000));
    }, interval);
    return () => clearInterval(t);
  }, [uptime < 60]);

  const ratio = Math.round((tokenUsage / Math.max(contextLimit, 1)) * 100);

  return (
    <box flexShrink={0} minWidth={24} width="28%" paddingLeft={1} paddingRight={1} paddingTop={1} flexDirection="column" gap={2}>
      {/* Server block */}
      <box flexDirection="column">
        <text>
          <strong fg={colors.accent.brand}>Server</strong>
        </text>
        <box backgroundColor={colors.bg.codeBlock} padding={1} flexDirection="column">
          <box flexDirection="row" gap={1}>
            <text fg={colors.text.muted}>up</text>
            <text fg={colors.text.secondary}>{fmtUptime(uptime)}</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={colors.text.muted}>tools</text>
            <text fg={colors.text.secondary}>{String(serverInfo.tools.length)}</text>
          </box>
          <box height={1} />
          <text fg={ratio > 90 ? colors.status.error : ratio > 75 ? colors.status.warning : colors.status.success}>
            {gauge(tokenUsage, contextLimit)}
          </text>
          <box flexDirection="row" gap={1}>
            <text fg={colors.text.muted}>{fmtK(tokenUsage)} / {fmtK(contextLimit)}</text>
            <text fg={colors.text.secondary}>{pct(tokenUsage, contextLimit)}</text>
          </box>
        </box>
      </box>

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
