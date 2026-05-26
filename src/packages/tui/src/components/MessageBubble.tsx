import type { Message } from "../types";

export function MessageBubble({ message }: { message: Message }) {
  switch (message.role) {
    case "user":
      return (
        <box flexDirection="row" paddingBottom={1} paddingLeft={2} paddingRight={2}>
          <text fg="#30363d">▌</text>
          <text fg="#e6edf3"> <span fg="#58a6ff">you</span>  {message.content}</text>
        </box>
      );
    case "assistant":
      return (
        <box paddingBottom={1} paddingLeft={2} paddingRight={2}>
          <text fg="#e6edf3">{message.content}{message.streaming ? <span fg="#484f58"> ▌</span> : undefined}</text>
        </box>
      );
    case "tool":
      return (
        <box paddingBottom={0} paddingLeft={4}>
          {message.state === "running" ? (
            <text fg="#d29922">◌ {message.toolName}</text>
          ) : message.state === "done" ? (
            <text fg="#3fb950">✓ {message.toolName}</text>
          ) : (
            <text fg="#f85149">✗ {message.toolName}: {message.detail}</text>
          )}
        </box>
      );
    case "error":
      return (
        <box paddingBottom={1} paddingLeft={4}>
          <text fg="#f85149">✗ {message.content}</text>
        </box>
      );
  }
}
