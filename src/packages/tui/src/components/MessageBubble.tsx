import type { Message } from "../types";
import { SyntaxStyle } from "@opentui/core";
import { useTheme } from "./App";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function MessageBubble({ message, syntaxStyle }: { message: Message; syntaxStyle: SyntaxStyle }) {
  const { colors } = useTheme();

  switch (message.role) {
    case "user":
      return <UserMessage message={message} />;

    case "assistant":
      return <AssistantMessage message={message} syntaxStyle={syntaxStyle} />;

    case "tool":
      return (
        <box paddingLeft={5} paddingBottom={0}>
          {message.state === "running" ? (
            <text fg={colors.status.warning}>◌ {message.toolName}</text>
          ) : message.state === "done" ? (
            <text fg={colors.status.success}>◉ {message.toolName} ✓</text>
          ) : (
            <text selectable fg={colors.status.error}>✕ {message.toolName}: {message.detail}</text>
          )}
        </box>
      );

    case "error":
      return (
        <box paddingLeft={5} paddingTop={1} paddingBottom={1}>
          <text selectable fg={colors.status.error}>✕ {message.content}</text>
        </box>
      );

    case "info":
      return (
        <box paddingLeft={5} paddingTop={1} paddingBottom={1} paddingRight={2}>
          {message.content.split("\n").map((line, i) => (
            <text key={i} fg={colors.text.secondary}>{line}</text>
          ))}
        </box>
      );
  }
}
