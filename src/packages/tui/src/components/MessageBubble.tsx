import type { Message, ToolGroupMessage } from "../types";
import { SyntaxStyle } from "@opentui/core";
import { useTheme } from "./App";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { ToolMessageBox } from "./ToolMessageBox";

export function MessageBubble({
  message,
  syntaxStyle,
  completedToolGroups,
  onOpenToolDetails,
}: {
  message: Message;
  syntaxStyle: SyntaxStyle;
  completedToolGroups?: ToolGroupMessage[];
  onOpenToolDetails?: (groups: ToolGroupMessage[]) => void;
}) {
  const { colors } = useTheme();

  switch (message.role) {
    case "user":
      return <UserMessage message={message} />;

    case "assistant":
      return (
        <AssistantMessage
          message={message as Message & { role: "assistant" }}
          syntaxStyle={syntaxStyle}
          completedToolGroups={completedToolGroups}
          onOpenToolDetails={onOpenToolDetails}
        />
      );

    case "tool-group":
      return <ToolMessageBox message={message} onOpenDetails={onOpenToolDetails} />;

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
