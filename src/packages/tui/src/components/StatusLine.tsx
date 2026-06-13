import { useTheme } from "./App";

interface StatusLineProps {
  hint?: string | null;
  processing: boolean;
}

export function StatusLine({ hint, processing }: StatusLineProps) {
  const { colors } = useTheme();

  return (
    <box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
      <text fg={processing ? colors.status.warning : colors.text.muted}>
        {processing ? '◌ processing...' : '◉ ready'}
      </text>
      <text fg={colors.text.muted}>
        {hint ?? 'Ctrl+C exit  / help'}
      </text>
    </box>
  );
}
