import { useState, useEffect } from "react";
import type { ServerInfo } from "../types";
import { useTheme } from "./App";

function gauge(used: number, limit: number, width = 16): string {
  const r = Math.min(used / Math.max(limit, 1), 1);
  const f = Math.round(r * width);
  return '█'.repeat(f) + '░'.repeat(width - f);
}

function fmtK(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

interface SidebarProps {
  serverInfo: ServerInfo;
  tokenUsage: number;
  contextLimit: number;
}

export function Sidebar({ serverInfo, tokenUsage, contextLimit }: SidebarProps) {
  const { colors } = useTheme();
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setUptime(s => s + 10), 10000);
    return () => clearInterval(t);
  }, []);

  const mins = Math.floor(uptime / 60);
  const secs = uptime % 60;
  const sandbox = serverInfo.sandbox.length > 28 ? '…' + serverInfo.sandbox.slice(-27) : serverInfo.sandbox;

  return (
    <box width={46} padding={1} flexDirection="column" gap={1}>
      <Card colors={colors} title="Server">
        <Row colors={colors} label="port"  value={String(serverInfo.port)} />
        <Row colors={colors} label="model" value={serverInfo.model} />
        <Row colors={colors} label="sand"  value={sandbox} />
        <Row colors={colors} label="up"    value={mins + 'm ' + secs + 's'} />
      </Card>

      <Card colors={colors} title="Tokens">
        <text fg={colors.status.warning}>{gauge(tokenUsage, contextLimit)}</text>
        <Row colors={colors} label={fmtK(tokenUsage) + ' / ' + fmtK(contextLimit)} value={Math.round((tokenUsage / Math.max(contextLimit, 1)) * 100) + '%'} />
      </Card>

      <Card colors={colors} title={'Tools (' + serverInfo.tools.length + ')'}>
        <text fg={colors.text.secondary}>{serverInfo.tools.join('  ')}</text>
      </Card>
    </box>
  );
}

function Card({ colors, title, children }: { colors: any; title: string; children: any }) {
  return (
    <box border borderColor={colors.border.default} padding={1} flexDirection="column" backgroundColor={colors.bg.page}>
      <box paddingBottom={1}>
        <text fg={colors.accent.brand}>{title}</text>
      </box>
      {children}
    </box>
  );
}

function Row({ colors, label, value }: { colors: any; label: string; value: string }) {
  return (
    <box flexDirection="row" gap={1}>
      <text fg={colors.text.muted}>{label}</text>
      <text fg={colors.text.secondary}>{value}</text>
    </box>
  );
}
