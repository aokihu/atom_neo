import { useTerminalDimensions } from "@opentui/react";
import type { ServerInfo } from "../types";
import { useTheme } from "./App";

interface StatusBarProps {
  serverInfo: ServerInfo;
}

export function StatusBar({ serverInfo }: StatusBarProps) {
  const { colors } = useTheme();
  const { width } = useTerminalDimensions();
  const thinkingColor =
    serverInfo.thinking === "enabled" ? colors.status.success :
    serverInfo.thinking === "adaptive" ? colors.status.warning :
    colors.text.muted;

  if (width < 100) {
    return (
      <box
        height={2}
        flexShrink={0}
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={1}
        paddingRight={1}
        border={["bottom"]}
        borderColor={colors.decoration.subtle}
      >
        <text fg={colors.accent.brand}>ATOM NEO</text>
        <text fg={colors.text.secondary}>{serverInfo.model}</text>
        <text fg={colors.text.muted}>v{serverInfo.version}</text>
      </box>
    );
  }

  return (
    <box
      height={2}
      flexShrink={0}
      flexDirection="row"
      border={["bottom"]}
      borderColor={colors.decoration.subtle}
    >
      <box width={16} paddingLeft={2}>
        <text fg={colors.accent.brand}>ATOM NEO</text>
      </box>
      <box width={18} paddingLeft={2} flexDirection="row" gap={1}>
        <text fg={colors.status.success}>CORE ONLINE</text>
      </box>
      <box width={24} paddingLeft={2}>
        <text fg={colors.text.secondary}>{serverInfo.model}</text>
      </box>
      <box width={13} paddingLeft={2}>
        <text fg={thinkingColor}>THINKING</text>
      </box>
      <box flexGrow={1} />
      <box width={12} paddingRight={2} justifyContent="flex-end">
        <text fg={colors.text.muted}>v{serverInfo.version}</text>
      </box>
    </box>
  );
}
