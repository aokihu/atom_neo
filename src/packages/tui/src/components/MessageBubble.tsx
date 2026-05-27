import type { Message } from "../types";
import { SyntaxStyle } from "@opentui/core";
import { useTheme } from "./App";

export function MessageBubble({ message, syntaxStyle }: { message: Message; syntaxStyle: SyntaxStyle }) {
  const { colors } = useTheme();

  switch (message.role) {
    case "user":
      return (
        <box flexDirection="row" paddingBottom={1} paddingLeft={2} paddingRight={2}>
          <text fg={colors.decoration.subtle}>▌</text>
          <text fg={colors.text.primary}> <span fg={colors.accent.brand}>you</span>  {message.content}</text>
        </box>
      );
    case "assistant":
      return (
        <box paddingBottom={1} paddingLeft={2} paddingRight={2}>
          <markdown
            content={message.content}
            streaming={message.streaming}
            syntaxStyle={syntaxStyle}
            conceal
          />
        </box>
      );
    case "tool":
      return (
        <box paddingBottom={0} paddingLeft={4}>
          {message.state === "running" ? (
            <text fg={colors.status.warning}>◌ {message.toolName}</text>
          ) : message.state === "done" ? (
            <text fg={colors.status.success}>✓ {message.toolName}</text>
          ) : (
            <text fg={colors.status.error}>✗ {message.toolName}: {message.detail}</text>
          )}
        </box>
      );
    case "error":
      return (
        <box paddingBottom={1} paddingLeft={4}>
          <text fg={colors.status.error}>✗ {message.content}</text>
        </box>
      );
  }
}
