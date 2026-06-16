import type { Message } from "../types";
import { useTheme } from "./App";

export function ToolMessageBox({ message }: { message: Extract<Message, { role: "tool" }> }) {
  const { colors } = useTheme();
  const isActive = message.phase === "preparing" || message.phase === "executing";

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}
         marginBottom={1}
         border={["left"]} borderColor={colors.text.muted} borderStyle="heavy">
      <box flexDirection="row" alignItems="center">
        {isActive && (
          <>
            <spinner name={message.phase === "preparing" ? "dots2" : "line"} />
            <text marginLeft={1} fg={colors.text.muted}>
              {message.phase === "preparing" ? `◌ ${message.toolName} preparing...` : `◉ ${message.toolName}`}
            </text>
          </>
        )}
        {message.phase === "done" && (
          <text fg={colors.status.success}>✓ {message.toolName}</text>
        )}
        {message.phase === "error" && (
          <text selectable fg={colors.status.error}>✕ {message.toolName}: {message.detail}</text>
        )}
      </box>
      {message.phase === "done" && message.detail && (
        <text fg={colors.text.muted} selectable>  ↳ {message.detail.slice(0, 300)}</text>
      )}
    </box>
  );
}
