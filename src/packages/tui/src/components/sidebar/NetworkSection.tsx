import { useTheme } from "@atom-neo/tui-kit";
import { useChatStore } from "../../stores/chat";
import { TelemetrySection } from "./TelemetrySection";
import { summarizeNetwork } from "./sidebar-metrics";

export function NetworkSection() {
  const { colors } = useTheme();
  const messages = useChatStore(state => state.messages);
  const { fetched, success, failed } = summarizeNetwork(messages);

  return <TelemetrySection title="NETWORK" meta="SESSION">
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.text.muted}>WEBFETCH</text>
      <text fg={colors.text.muted}>{fetched}</text>
    </box>
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.text.muted}>SUCCESS</text>
      <text fg={colors.text.muted}>{success}</text>
    </box>
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.text.muted}>FAILED</text>
      <text fg={failed > 0 ? colors.status.error : colors.text.muted}>{failed}</text>
    </box>
  </TelemetrySection>;
}
