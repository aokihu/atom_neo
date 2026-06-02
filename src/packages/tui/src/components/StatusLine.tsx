import { useTheme } from "./App";

export function StatusLine({ hint, processing }: { hint?: string | null; processing?: boolean }) {
  const { colors } = useTheme();

  return (
    <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={colors.bg.input}>
      {processing ? (
        <text fg={colors.status.warning}>⏳ processing...</text>
      ) : hint ? (
        <text fg={colors.status.warning}>{hint}</text>
      ) : (
        <text fg={colors.text.muted}> </text>
      )}
    </box>
  );
}
