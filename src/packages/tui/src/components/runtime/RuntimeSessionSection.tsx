import { useTheme } from "@atom-neo/tui-kit";
import { EmptyState } from "../EmptyState";
import { formatUptime } from "../format";
import { RuntimeSection } from "./RuntimeSection";

export function RuntimeSessionSection({ busy, uptime }: { busy: boolean; uptime: number }) {
  const { colors } = useTheme();
  return <RuntimeSection>
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.text.muted}>SESSION</text>
      <text fg={busy ? colors.status.warning : colors.text.muted}>{busy ? "ACTIVE" : "IDLE"}</text>
    </box>
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.text.muted}>UPTIME</text>
      <text fg={colors.text.muted}>{formatUptime(uptime)}</text>
    </box>
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.text.muted}>QUEUE</text>
      {busy ? <text fg={colors.text.muted}>1 ACTIVE</text> : <EmptyState />}
    </box>
  </RuntimeSection>;
}
