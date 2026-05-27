import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";
import { useTheme } from "./App";

export function ChatView({ messages }: { messages: Message[] }) {
  const { colors, syntaxStyle } = useTheme();

  if (messages.length === 0) {
    return (
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
        <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
          <text fg={colors.accent.brand}><strong>atom neo</strong></text>
          <text fg={colors.text.secondary}>AI-driven development platform</text>
          <text fg={colors.text.muted}>{`  `}</text>
          <text fg={colors.text.secondary}>Type a message below to get started.</text>
        </box>
      </scrollbox>
    );
  }

  return (
    <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" paddingTop={1}>
      {messages.map(msg =>
        msg.role === "thinking"
          ? <SpinnerBubble key={msg.id} />
          : <MessageBubble key={msg.id} message={msg} syntaxStyle={syntaxStyle} />
      )}
      <box height={1} />
    </scrollbox>
  );
}

const FRAMES = [
  "█▓▒░·",
  "░█▓▒░",
  "·░█▓▒",
  "··░█▓",
  "···░█",
  "····░",
  "···░█",
  "··░█▓",
  "·░█▓▒",
  "░█▓▒░",
];

import { useState, useEffect } from "react";

function SpinnerBubble() {
  const { colors } = useTheme();
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(n => (n + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <box paddingLeft={2}>
      <text fg={colors.accent.brand}>{FRAMES[i]}</text>
    </box>
  );
}
