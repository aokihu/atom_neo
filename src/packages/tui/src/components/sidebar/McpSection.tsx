import { useTheme } from "@atom-neo/tui-kit";
import { useChatStore } from "../../stores/chat";
import { EmptyState } from "../EmptyState";
import { TelemetrySection } from "./TelemetrySection";

export function McpSection() {
  const { colors } = useTheme();
  const mcpServers = useChatStore(state => state.mcpServers);
  const mcpOnline = mcpServers.filter(server => server.online).length;

  return <TelemetrySection title="MCP" meta={`${mcpOnline}/${mcpServers.length}`}>
    {mcpServers.length === 0
      ? <EmptyState />
      : mcpServers.slice(0, 4).map(server => (
        <box key={server.name} flexDirection="row" justifyContent="space-between">
          <text fg={colors.text.muted}>{server.name}</text>
          <text fg={server.online ? colors.text.muted : colors.status.error}>
            {server.online ? "ONLINE" : "OFFLINE"}
          </text>
        </box>
      ))}
  </TelemetrySection>;
}
