import type { ServerInfo } from "../types";
import { useTheme } from "./App";

function gauge(used: number, limit: number, width = 8): string {
  const r = Math.min(used / Math.max(limit, 1), 1);
  const f = Math.round(r * width);
  return '█'.repeat(f) + '░'.repeat(width - f);
}

function pct(used: number, limit: number): string {
  return Math.round((used / Math.max(limit, 1)) * 100) + '%';
}

interface StatusBarProps {
  serverInfo: ServerInfo;
  tokenUsage: number;
  contextLimit: number;
}

export function StatusBar({ serverInfo, tokenUsage, contextLimit }: StatusBarProps) {
  const { colors } = useTheme();
  const ratioStr = 'tokens ' + gauge(tokenUsage, contextLimit) + ' ' + pct(tokenUsage, contextLimit);
  const sep = <text fg={colors.decoration.subtle}> ▎ </text>;

  return (
    <box flexShrink={0} border={["bottom"]} borderColor={colors.decoration.subtle} borderStyle="single">
      <box flexDirection="row" paddingLeft={2} paddingRight={2} gap={1} height={1}>
        <text fg={colors.accent.brand}>atom neo</text>
        {sep}
        <text fg={colors.status.success}>●</text>
        <text fg={colors.text.secondary}>connected</text>
        {sep}
        <text fg={colors.text.secondary}>{serverInfo.model}</text>
        {sep}
        <text fg={colors.text.secondary}>{ratioStr}</text>
        {sep}
        <text fg={colors.text.muted}>v{serverInfo.version}</text>
      </box>
    </box>
  );
}
