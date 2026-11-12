import type { ReactNode } from "react";
import { useTheme } from "@atom-neo/tui-kit";

export function TelemetrySection({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      marginBottom={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={colors.text.muted}>{title}</text>
        {meta && <text fg={colors.text.muted}>{meta}</text>}
      </box>
      {children}
    </box>
  );
}
