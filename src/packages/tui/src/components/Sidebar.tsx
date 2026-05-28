import { useState, useEffect } from "react";
import type { ServerInfo } from "../types";
import { useTheme } from "./App";

export function Sidebar({ serverInfo, tokenUsage, contextLimit }: {
  serverInfo: ServerInfo;
  tokenUsage: number;
  contextLimit: number;
}) {
  const { colors } = useTheme();
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setUptime(t => t + 10), 10000);
    return () => clearInterval(timer);
  }, []);

  const mins = Math.floor(uptime / 60);
  const secs = uptime % 60;

  return (
    <box
      width={48}
      borderStyle="single"
      borderColor={colors.border.default}
      backgroundColor={colors.bg.page}
      padding={1}
      flexDirection="column"
    >
      <text fg={colors.text.primary}><strong>Info</strong></text>
      <text fg={colors.border.default}>{'─'.repeat(44)}</text>

      <box flexDirection="row" gap={1}>
        <text fg={colors.text.muted}>port</text>
        <text fg={colors.text.secondary}>{String(serverInfo.port)}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={colors.text.muted}>host</text>
        <text fg={colors.text.secondary}>{serverInfo.host}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={colors.text.muted}>model</text>
        <text fg={colors.text.secondary}>{serverInfo.model}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={colors.text.muted}>root</text>
        <text fg={colors.text.secondary}>{serverInfo.sandbox.length > 32 ? `…${serverInfo.sandbox.slice(-31)}` : serverInfo.sandbox}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={colors.text.muted}>up</text>
        <text fg={colors.text.secondary}>{mins}m {secs}s</text>
      </box>

      <text fg={colors.border.default}>{'─'.repeat(44)}</text>
      <text fg={colors.text.secondary}>{serverInfo.tools.join("  ")}</text>

      <text fg={colors.border.default}>{'─'.repeat(44)}</text>
      <text fg={colors.text.primary}><strong>Usage</strong></text>
      <box flexDirection="row" gap={1}>
        <text fg={colors.text.muted}>tokens</text>
        <text fg={colors.text.secondary}>{String(tokenUsage)}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={colors.text.muted}>ratio</text>
        <text fg={colors.text.secondary}>{((tokenUsage / contextLimit) * 100).toFixed(2)}%</text>
      </box>

      <text flexGrow={1} />
      <text fg={colors.decoration.subtle}>{'─'.repeat(44)}</text>
      <text fg={colors.text.muted}>v{serverInfo.version}</text>
    </box>
  );
}
