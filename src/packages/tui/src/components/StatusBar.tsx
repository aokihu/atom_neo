import { useTheme } from "./App";

export function StatusBar() {
  const { colors } = useTheme();

  return (
    <box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
      <box flexDirection="row" gap={1}>
        <text fg={colors.accent.brand}><strong>atom</strong></text>
        <text fg={colors.text.secondary}>neo</text>
      </box>
      <text fg={colors.status.success}>● ready</text>
    </box>
  );
}
