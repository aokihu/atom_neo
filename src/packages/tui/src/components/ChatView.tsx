import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";

export function ChatView({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
        <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
          <text fg="#58a6ff"><strong>atom neo</strong></text>
          <text fg="#8b949e">AI-driven development platform</text>
          <text fg="#484f58">{`  `}</text>
          <text fg="#8b949e">Type a message below to get started.</text>
        </box>
      </scrollbox>
    );
  }

  return (
    <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" paddingTop={1}>
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <box height={1} />
    </scrollbox>
  );
}
