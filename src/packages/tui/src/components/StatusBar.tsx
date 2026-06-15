import type { ServerInfo } from "../types";
import { useTheme } from "./App";

interface StatusBarProps {
  serverInfo: ServerInfo;
}

export function StatusBar({ serverInfo }: StatusBarProps) {
  const { colors } = useTheme();
  const sep = <text fg={colors.decoration.subtle}> ▎ </text>;
  const thinkingColor =
    serverInfo.thinking === "enabled" ? colors.status.success :
    serverInfo.thinking === "adaptive" ? colors.status.warning :
    colors.text.muted;

  return (
    <box flexShrink={0} border={["bottom"]} borderColor={colors.decoration.subtle} borderStyle="single">
      <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} height={1}>
        <box flexDirection="row" gap={1}>
          <text fg={colors.accent.brand}>atom neo</text>
          {sep}
          <text fg={colors.status.success}>●</text>
          <text fg={colors.text.secondary}>connected</text>
          {sep}
          <text fg={colors.text.secondary}>{serverInfo.model}</text>
          <text fg={thinkingColor}>[thinking]</text>
        </box>
        <text fg={colors.text.muted}>v{serverInfo.version}</text>
      </box>
    </box>
  );
}
