import type { Message } from "../types";
import { useTheme } from "./App";
import { fmtTime } from "./format";

export function UserMessage({ message }: { message: Message & { role: "user" } }) {
  const { colors } = useTheme();

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}
         marginBottom={1} border={["bottom"]} borderColor={colors.decoration.subtle}
         flexDirection="column">
      <box flexDirection="row" gap={2}>
        <text fg={colors.accent.brand}>USER</text>
        <text fg={colors.text.muted}>{fmtTime(message.timestamp)}</text>
      </box>
      <text selectable fg={colors.text.primary}>{message.content}</text>
    </box>
  );
}
