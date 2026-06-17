import { BounceBarSpinner } from "./BounceBarSpinner";
import { useTheme } from "./App";

interface StatusLineProps {
  hint?: string | null;
  processing: boolean;
}

export function StatusLine({ hint, processing }: StatusLineProps) {
  const { colors } = useTheme();

  return (
    <box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
      {processing
        ? (
          <box flexDirection="row" alignItems="center">
            <BounceBarSpinner />
            <text marginLeft={1} fg={colors.text.muted}>processing</text>
          </box>
        )
        : <text fg={colors.text.muted}>◉ ready</text>}
      <text fg={colors.text.muted}>
        {hint ?? '↑↓ history  / commands  ↩ send'}
      </text>
    </box>
  );
}
