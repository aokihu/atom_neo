import type { Message, ToolGroupMessage } from "../types";

export type CompletedToolPlacement = {
  byAssistantId: Map<string, ToolGroupMessage[]>;
  attachedGroupIds: Set<string>;
};

export type ChatViewModel = {
  isEmpty: boolean;
  messages: Message[];
  completedTools: CompletedToolPlacement;
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

export function buildChatViewModel(messages: Message[]): ChatViewModel {
  return {
    isEmpty: messages.length === 0,
    messages,
    completedTools: placeCompletedToolGroups(messages),
  };
}
