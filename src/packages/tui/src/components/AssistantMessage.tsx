import { useState, useEffect, useRef } from "react";
import { useTheme } from "./App";
import type { Message } from "../types";
import { SyntaxStyle } from "@opentui/core";
import { fmtTime, formatDuration } from "./format";
import { ToolSummaryTrigger } from "./ToolMessageBox";
import type { ToolGroupMessage } from "../types";

export function AssistantMessage({
  message,
  syntaxStyle,
  completedToolGroups = [],
  onOpenToolDetails,
}: {
  message: Message & { role: "assistant" };
  syntaxStyle: SyntaxStyle;
  completedToolGroups?: ToolGroupMessage[];
  onOpenToolDetails?: (groups: ToolGroupMessage[]) => void;
}) {
  const { colors } = useTheme();
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const prevStreamingRef = useRef(message.streaming);

  useEffect(() => {
    if (prevStreamingRef.current && !message.streaming) {
      setThinkingExpanded(false);
    }
    prevStreamingRef.current = message.streaming;
  }, [message.streaming]);

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}
         marginBottom={1} flexDirection="column">
      <box flexDirection="row" gap={2}>
        <text fg={colors.accent.brand}>ATOM NEO</text>
        <text fg={colors.text.muted}>{fmtTime(message.timestamp)}</text>
        {message.streaming && <text fg={colors.status.warning}>STREAMING</text>}
      </box>
      {(message.reasoningContent || completedToolGroups.length > 0) && (
        <box marginBottom={1} flexDirection="column">
          <box flexDirection="row">
            {message.reasoningContent && (
              <box onMouseUp={() => setThinkingExpanded(!thinkingExpanded)}>
                <text fg={colors.text.muted}>
                  {thinkingExpanded
                    ? "THOUGHT ▼"
                    : `THOUGHT ${formatDuration(message.thinkingDuration ?? 0)} ▸`}
                </text>
              </box>
            )}
            {completedToolGroups.length > 0 && (
              <ToolSummaryTrigger
                groups={completedToolGroups}
                inline={Boolean(message.reasoningContent)}
                onOpen={onOpenToolDetails}
              />
            )}
          </box>
          {thinkingExpanded && (
            <text selectable fg={colors.text.muted}>{message.reasoningContent}</text>
          )}
        </box>
      )}
      <markdown
        content={message.content}
        streaming={message.streaming}
        syntaxStyle={syntaxStyle}
        conceal
      />
    </box>
  );
}
