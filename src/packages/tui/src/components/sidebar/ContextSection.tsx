import { useTheme } from "@atom-neo/tui-kit";
import { useChatStore } from "../../stores/chat";
import { TelemetrySection } from "./TelemetrySection";
import { buildGauge, pct, SIDEBAR_CONTENT_WIDTH } from "./sidebar-metrics";

export function ContextSection({ contextLimit }: { contextLimit: number }) {
  const { colors } = useTheme();
  const contextTokens = useChatStore(state => state.contextTokens);
  const ratio = Math.round((contextTokens / Math.max(contextLimit, 1)) * 100);

  return <TelemetrySection title="CONTEXT" meta={pct(contextTokens, contextLimit)}>
    <text fg={ratio > 90 ? colors.status.error : ratio > 75 ? colors.status.warning : colors.status.success}>
      {buildGauge(contextTokens, contextLimit, SIDEBAR_CONTENT_WIDTH)}
    </text>
    <text fg={colors.text.secondary}>{`${contextTokens.toLocaleString()} / ${contextLimit.toLocaleString()}`}</text>
  </TelemetrySection>;
}
