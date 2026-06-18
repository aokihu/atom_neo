import type { Message } from "../types";
import { useTheme } from "./App";

export function ThinkingMessageBox({ message }: { message: Extract<Message, { role: "reasoning" }> }) {
  const { colors } = useTheme();

  return (
    <box paddingLeft={2} paddingRight={2} marginBottom={1}
         border={["left"]} borderColor={colors.decoration.subtle} borderStyle="heavy">
      <text fg={colors.text.muted}>Thinking</text>
      <text selectable fg={colors.text.muted}>{message.content}</text>
    </box>
  );
}
