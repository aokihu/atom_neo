import { useTheme } from "@atom-neo/tui-kit";
import { useChatStore } from "../../stores/chat";
import { TelemetrySection } from "./TelemetrySection";
import { summarizeTools, toolState } from "./sidebar-metrics";

export function ToolsSection() {
  const { colors } = useTheme();
  const messages = useChatStore(state => state.messages);
  const toolInfos = useChatStore(state => state.toolInfos);
  const { entries, running, builtin, mcp } = summarizeTools(messages, toolInfos);

  return <TelemetrySection title="TOOLS" meta={`${running} RUN`}>
    {entries.length === 0
      ? (
        <>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={colors.text.muted}>BUILTIN</text>
            <text fg={colors.text.muted}>{builtin}</text>
          </box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={colors.text.muted}>MCP</text>
            <text fg={colors.text.muted}>{mcp}</text>
          </box>
        </>
      )
      : entries.slice(-3).map(entry => {
        const state = toolState(entry.phase);
        const stateColor = state === "ERR" ? colors.status.error
          : state === "RUN" ? colors.status.warning
            : colors.text.muted;
        return (
          <box key={entry.toolCallId} flexDirection="row" justifyContent="space-between">
            <text fg={state === "RUN" ? colors.text.secondary : colors.text.muted}>{entry.toolName}</text>
            <text fg={stateColor}>{state}</text>
          </box>
        );
      })}
  </TelemetrySection>;
}
