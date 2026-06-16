import type { Message } from "../types";
import { useTheme } from "./App";

export function ToolMessageBox({ message }: { message: Extract<Message, { role: "tool" }> }) {
  const { colors } = useTheme();

  return (
    <box paddingLeft={5} paddingBottom={0} flexDirection="column">
      {message.phase === "preparing" ? (
        <text fg={colors.text.muted}>◌ {message.toolName} preparing...</text>
      ) : message.phase === "executing" ? (
        <text fg={colors.status.warning}>◉ {message.toolName}</text>
      ) : message.phase === "done" ? (
        <text fg={colors.status.success}>◉ {message.toolName} ✓</text>
      ) : (
        <text selectable fg={colors.status.error}>✕ {message.toolName}: {message.detail}</text>
      )}

      {message.phase === "done" && message.detail ? (
        <text fg={colors.text.muted} selectable>  ↳ {message.detail.slice(0, 300)}</text>
      ) : null}
    </box>
  );
}
