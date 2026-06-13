import type { Message } from "../types";
import { useTheme } from "./App";
import { fmtTime } from "./MessageBubble";

export function UserMessage({ message }: { message: Message & { role: "user" } }) {
  const { colors } = useTheme();

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}
         marginBottom={1}
         border={["left"]} borderColor={colors.status.success}
         borderStyle="heavy">
      <text selectable fg={colors.text.primary}>{message.content}</text>
      <text fg={colors.text.muted}>{fmtTime(message.timestamp)}</text>
    </box>
  );
}
