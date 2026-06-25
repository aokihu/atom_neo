import { useState, useEffect, useRef } from "react";
import { useTheme } from "./App";
import type { Message } from "../types";
import { SyntaxStyle } from "@opentui/core";
import { formatDuration } from "./MessageBubble";

export function AssistantMessage({ message, syntaxStyle }: { message: Message & { role: "assistant" }; syntaxStyle: SyntaxStyle }) {
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
         marginBottom={1}
         border={["left"]} borderColor={colors.accent.brand}
         borderStyle="heavy">
      {message.reasoningContent && (
        <box marginBottom={1} onMouseUp={() => setThinkingExpanded(!thinkingExpanded)}>
          <text fg={colors.text.muted}>
            {thinkingExpanded
              ? 'Thinking:'
              : `Thought - ${formatDuration(message.thinkingDuration ?? 0)} ▸`}
          </text>
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
