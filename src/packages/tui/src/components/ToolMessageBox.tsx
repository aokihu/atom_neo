import type { Message } from "../types";
import { useTheme } from "./App";

export function ToolMessageBox({ message }: { message: Extract<Message, { role: "tool-group" }> }) {
  const { colors } = useTheme();

  if (message.collapsed && message.summary) {
    const { total, success, failed, toolNames } = message.summary;
    return (
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}
           marginBottom={1}
           border={["left"]} borderColor={colors.text.muted} borderStyle="heavy">
        <text fg={failed > 0 ? colors.status.warning : colors.status.success}>
          ◆ {total} tools ✓ — {toolNames.join(", ")}
        </text>
      </box>
    );
  }

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}
         marginBottom={1}
         border={["left"]} borderColor={colors.text.muted} borderStyle="heavy">
      {message.entries.map(e => {
        const active = e.phase === "preparing" || e.phase === "executing";
        return (
          <box key={e.toolCallId} flexDirection="row" alignItems="center">
            {active && (
              <>
                <spinner name="line" />
                <text marginLeft={1} fg={colors.text.muted}>◉ {e.toolName}</text>
              </>
            )}
            {e.phase === "done" && (
              <text fg={colors.status.success}>✓ {e.toolName}</text>
            )}
            {e.phase === "error" && (
              <text selectable fg={colors.status.error}>✕ {e.toolName}: {e.detail}</text>
            )}
          </box>
        );
      })}
    </box>
  );
}
