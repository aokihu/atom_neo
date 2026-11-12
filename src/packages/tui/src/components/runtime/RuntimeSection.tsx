import type { ReactNode } from "react";
import { useTheme } from "@atom-neo/tui-kit";
import type { ThemeColors } from "@atom-neo/tui-kit";
import type { PipelineState } from "./runtime-steps";

export function RuntimeSection({ title, children }: { title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <box
      flexDirection="column"
      marginBottom={1}
      paddingLeft={1}
      paddingRight={1}
    >
      {title && <text fg={colors.text.muted}>{title}</text>}
      {children}
    </box>
  );
}

export function stateColor(colors: ThemeColors, state: PipelineState): string {
  return state === "RUN" ? colors.status.warning
    : state === "OK" ? colors.status.success
      : state === "ERR" ? colors.status.error
        : colors.text.muted;
}
