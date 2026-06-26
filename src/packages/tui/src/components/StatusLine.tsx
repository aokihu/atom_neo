import { BounceBarSpinner } from "./BounceBarSpinner";
import { useTheme } from "./App";
import { useChatStore } from "../stores/chat";

interface StatusLineProps {
  hint?: string | null;
}

export function StatusLine({ hint }: StatusLineProps) {
  const { colors } = useTheme();
  const processing = useChatStore(s => {
    if (s.busy) return true;
    return s.messages.some(m =>
      m.role === "tool-group" && !m.collapsed &&
      m.entries.some(e => e.phase === "executing" || e.phase === "preparing")
    );
  });

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
