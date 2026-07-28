import { useMemo } from "react";
import { useChatStore } from "../stores/chat";
import { MessageBubble } from "./MessageBubble";
import { useTheme } from "./App";
import { ThinkingSpinner } from "./ThinkingSpinner";
import type { Message, ToolGroupMessage } from "../types";

type CompletedToolPlacement = {
  byAssistantId: Map<string, ToolGroupMessage[]>;
  attachedGroupIds: Set<string>;
};

export function placeCompletedToolGroups(messages: Message[]): CompletedToolPlacement {
  const byAssistantId = new Map<string, ToolGroupMessage[]>();
  const attachedGroupIds = new Set<string>();

  const placeTurn = (start: number, end: number) => {
    const turn = messages.slice(start, end);
    const assistant = turn.findLast(
      message => message.role === "assistant" && Boolean(message.reasoningContent),
    ) ?? turn.findLast(message => message.role === "assistant");
    if (!assistant) return;
    const groups = turn.filter(
      (message): message is ToolGroupMessage =>
        message.role === "tool-group" && message.collapsed && Boolean(message.summary),
    );
    if (groups.length === 0) return;
    byAssistantId.set(assistant.id, groups);
    for (const group of groups) attachedGroupIds.add(group.id);
  };

  let turnStart = 0;
  for (let index = 1; index < messages.length; index++) {
    if (messages[index]?.role !== "user") continue;
    placeTurn(turnStart, index);
    turnStart = index;
  }
  placeTurn(turnStart, messages.length);

  return { byAssistantId, attachedGroupIds };
}

export function ChatView({
  onOpenToolDetails,
}: {
  onOpenToolDetails?: (groups: ToolGroupMessage[]) => void;
}) {
  const { colors, syntaxStyle } = useTheme();
  const messages = useChatStore(s => s.messages);
  const showPreparing = useChatStore(s => s.showPreparing);
  const completedTools = useMemo(() => placeCompletedToolGroups(messages), [messages]);

  if (messages.length === 0) {
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
      {messages.map(msg => (
        completedTools.attachedGroupIds.has(msg.id)
          ? null
          : (
            <MessageBubble
              key={msg.id}
              message={msg}
              syntaxStyle={syntaxStyle}
              completedToolGroups={completedTools.byAssistantId.get(msg.id)}
              onOpenToolDetails={onOpenToolDetails}
            />
          )
      ))}
      {showPreparing && <ThinkingSpinner />}
      <box height={1} />
    </scrollbox>
  );
}
