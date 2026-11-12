import { useTheme } from "@atom-neo/tui-kit";
import { RuntimeSection } from "./RuntimeSection";

export function RuntimeStatsSection({
  messages,
  completed,
  failed,
}: {
  messages: number;
  completed: number;
  failed: number;
}) {
  const { colors } = useTheme();
  return <RuntimeSection title="STATS">
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.text.muted}>MESSAGES</text>
      <text fg={colors.text.muted}>{messages}</text>
    </box>
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.text.muted}>TOOLS OK</text>
      <text fg={colors.text.muted}>{completed}</text>
    </box>
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.text.muted}>TOOLS ERR</text>
      <text fg={failed > 0 ? colors.status.error : colors.text.muted}>{failed}</text>
    </box>
  </RuntimeSection>;
}
