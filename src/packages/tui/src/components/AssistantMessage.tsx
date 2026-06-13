import type { Message } from "../types";
import { SyntaxStyle } from "@opentui/core";
import { useTheme } from "./App";

export function AssistantMessage({ message, syntaxStyle }: { message: Message & { role: "assistant" }; syntaxStyle: SyntaxStyle }) {
  const { colors } = useTheme();

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}
         marginBottom={1}
         border={["left"]} borderColor={colors.accent.brand}
         borderStyle="heavy">
      <markdown
        content={message.content}
        streaming={message.streaming}
        syntaxStyle={syntaxStyle}
        conceal
      />
    </box>
  );
}
