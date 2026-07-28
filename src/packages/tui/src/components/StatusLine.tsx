import { useTerminalDimensions } from "@opentui/react";
import { BounceBarSpinner } from "./BounceBarSpinner";
import { useTheme } from "./App";
import { useChatStore } from "../stores/chat";

interface StatusLineProps {
  hint?: string | null;
}

export function StatusLine({ hint }: StatusLineProps) {
  const { colors } = useTheme();
  const { width } = useTerminalDimensions();
  const processing = useChatStore(s => {
    if (s.busy) return true;
    return s.messages.some(m =>
      m.role === "tool-group" && !m.collapsed &&
      m.entries.some(e => e.phase === "executing" || e.phase === "preparing")
    );
  });

  return (
    <box
      height={2}
      flexShrink={0}
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={2}
      paddingRight={2}
      border={["top"]}
      borderColor={colors.border.default}
    >
      {processing
        ? (
          <box flexDirection="row" alignItems="center">
            <BounceBarSpinner />
            <text marginLeft={1} fg={colors.text.muted}>processing</text>
          </box>
        )
        : <text fg={colors.status.success}>● ready</text>}
      <text fg={colors.text.muted}>
        {hint ?? (width >= 100 ? "↑↓ history  / commands  ↩ send  Esc×2 cancel" : "/ commands  ↩ send")}
      </text>
    </box>
  );
}
