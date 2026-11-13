import { useMemo } from "react";
import { useChatStore } from "../stores/chat";
import { MessageBubble } from "./MessageBubble";
import { useTheme } from "@atom-neo/tui-kit";
import { ThinkingSpinner } from "./ThinkingSpinner";
import { buildChatViewModel } from "./chat-view-model";
import type { ToolGroupMessage } from "../types";

export { placeCompletedToolGroups } from "./chat-view-model";

export function ChatView({
  onOpenToolDetails,
}: {
  onOpenToolDetails?: (groups: ToolGroupMessage[]) => void;
}) {
  const { colors, syntaxStyle } = useTheme();
  const messages = useChatStore(s => s.messages);
  const showPreparing = useChatStore(s => s.showPreparing);
  const view = useMemo(() => buildChatViewModel(messages), [messages]);

  if (view.isEmpty) {
    return (
      <scrollbox flexGrow={1} flexBasis={0} stickyScroll stickyStart="bottom">
        <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
          <text fg={colors.accent.brand}>ATOM NEO</text>
          <text fg={colors.text.secondary}>CONVERSATION CHANNEL READY</text>
          <text fg={colors.text.muted}>{'  '}</text>
          <text fg={colors.text.muted}>Type a message below to begin.</text>
          {showPreparing && <ThinkingSpinner />}
        </box>
      </scrollbox>
    );
  }

  return (
    <scrollbox flexGrow={1} flexBasis={0} stickyScroll stickyStart="bottom" paddingTop={1}>
      {syntaxStyle && view.messages.map(msg => (
        view.completedTools.attachedGroupIds.has(msg.id)
          ? null
          : (
            <MessageBubble
              key={msg.id}
              message={msg}
              syntaxStyle={syntaxStyle}
              completedToolGroups={view.completedTools.byAssistantId.get(msg.id)}
              onOpenToolDetails={onOpenToolDetails}
            />
          )
      ))}
      {showPreparing && <ThinkingSpinner />}
      <box height={1} />
    </scrollbox>
  );
}
