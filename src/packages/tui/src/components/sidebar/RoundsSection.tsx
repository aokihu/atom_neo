import { useTheme } from "@atom-neo/tui-kit";
import { useChatStore } from "../../stores/chat";
import { EmptyState } from "../EmptyState";
import { TelemetrySection } from "./TelemetrySection";
import { buildGauge, SIDEBAR_CONTENT_WIDTH } from "./sidebar-metrics";

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
