import { useChatStore } from "../stores/chat";
import { MessageBubble } from "./MessageBubble";
import { useTheme } from "./App";
import { ThinkingSpinner } from "./ThinkingSpinner";

export function ChatView() {
  const { colors, syntaxStyle } = useTheme();
  const messages = useChatStore(s => s.messages);
  const showPreparing = useChatStore(s => s.showPreparing);

  if (messages.length === 0) {
    return (
      <scrollbox flexGrow={1} flexBasis={0} stickyScroll stickyStart="bottom">
        <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
          <text fg={colors.accent.brand}>atom neo</text>
          <text fg={colors.text.secondary}>AI-driven development platform</text>
          <text fg={colors.text.muted}>{'  '}</text>
          <text fg={colors.text.secondary}>Type a message below to get started.</text>
          {showPreparing && <ThinkingSpinner />}
        </box>
      </scrollbox>
    );
  }

  return (
    <scrollbox flexGrow={1} flexBasis={0} stickyScroll stickyStart="bottom" paddingTop={1}>
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} syntaxStyle={syntaxStyle} />
      ))}
      {showPreparing && <ThinkingSpinner />}
      <box height={1} />
    </scrollbox>
  );
}
