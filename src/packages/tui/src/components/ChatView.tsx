import { useState, useEffect } from "react";
import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";
import { useTheme } from "./App";

export function ChatView({ messages }: { messages: Message[] }) {
  const { colors, syntaxStyle } = useTheme();

  if (messages.length === 0) {
    return (
      <scrollbox flexGrow={1} flexBasis={0} stickyScroll stickyStart="bottom">
        <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
          <text fg={colors.accent.brand}>atom neo</text>
          <text fg={colors.text.secondary}>AI-driven development platform</text>
          <text fg={colors.text.muted}>{'  '}</text>
          <text fg={colors.text.secondary}>Type a message below to get started.</text>
        </box>
      </scrollbox>
    );
  }

  return (
    <scrollbox flexGrow={1} flexBasis={0} stickyScroll stickyStart="bottom" paddingTop={1}>
      {messages.map(msg =>
        msg.role === "thinking"
          ? <ThinkingDots key={msg.id} />
          : <MessageBubble key={msg.id} message={msg} syntaxStyle={syntaxStyle} />
      )}
      <box height={1} />
    </scrollbox>
  );
}

function ThinkingDots() {
  const { colors } = useTheme();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % 3), 300);
    return () => clearInterval(t);
  }, []);
  const dots = '.'.repeat(frame + 1);
  return (
    <box paddingLeft={5} paddingTop={1} paddingBottom={1}>
      <text fg={colors.accent.brand}>thinking{dots}</text>
    </box>
  );
}
