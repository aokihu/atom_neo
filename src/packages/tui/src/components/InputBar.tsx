import { useState, useRef, useCallback } from "react";
import { useTheme } from "./App";
import { CommandMenu } from "./CommandMenu";
import { useInputHistory } from "../stores/inputHistory";
import type { TextareaRenderable, BorderCharacters, KeyBinding, KeyEvent } from "@opentui/core";

const thinBorder: BorderCharacters = {
  topLeft: "\u2584",
  topRight: "\u2584",
  bottomLeft: "\u2580",
  bottomRight: "\u2580",
  horizontal: "\u2580",
  vertical: "\u258F",
  topT: "\u2584",
  bottomT: "\u2580",
  leftT: "\u258F",
  rightT: "\u258F",
  cross: "\u2588",
};

const keyBindings: KeyBinding[] = [
  { name: "enter", action: "submit" },
  { name: "enter", shift: true, action: "newline" },
];

export function InputBar({ onSend, onQuit }: { onSend: (text: string) => void; onQuit?: () => void }) {
  const { colors } = useTheme();
  const taRef = useRef<TextareaRenderable>(null);
  const [content, setContent] = useState("");
  const navigatingRef = useRef(false);
  const { push, navigateUp, navigateDown, resetIndex, setDraft } = useInputHistory();

  const showMenu = content.startsWith("/");

  const handleContentChange = useCallback(() => {
    setContent(taRef.current?.plainText ?? "");
    if (navigatingRef.current) return;
    resetIndex();
  }, [resetIndex]);

  const handleSubmit = useCallback(() => {
    const text = taRef.current?.plainText?.trim();
    if (!text) return;

    if (text === "/quit") {
      onQuit?.();
      taRef.current?.setText("");
      setContent("");
      return;
    }

    push(text.trim());
    onSend(text);
    taRef.current?.setText("");
    setContent("");
  }, [onSend, onQuit, push]);

  const handleKeyDown = useCallback((event: KeyEvent) => {
    if (event.ctrl || event.meta) return;

    if (event.name === "up") {
      event.preventDefault();
      const ta = taRef.current;
      if (!ta) return;
      const result = navigateUp();
      if (result.idx === 0) setDraft(ta.plainText);
      if (result.idx >= 0) {
        navigatingRef.current = true;
        ta.replaceText(result.prev);
        navigatingRef.current = false;
      }
    } else if (event.name === "down") {
      event.preventDefault();
      const ta = taRef.current;
      if (!ta) return;
      const result = navigateDown();
      navigatingRef.current = true;
      ta.replaceText(result === null ? useInputHistory.getState().draft : result.text);
      navigatingRef.current = false;
    }
  }, [navigateUp, navigateDown, setDraft]);

  return (
    <box flexShrink={0}>
      <box
        height={5}
        marginTop={1}
        marginLeft={0} marginRight={0} marginBottom={0}
        padding={1}
        border={["left"]}
        borderColor={colors.accent.brand}
        customBorderChars={thinBorder}
        backgroundColor={colors.bg.input}
      >
        <textarea
          ref={taRef}
          placeholder="Message... (Shift+Enter for newline, ↑↓ for history, / for commands)"
          onSubmit={handleSubmit}
          onContentChange={handleContentChange}
          onKeyDown={handleKeyDown}
          keyBindings={keyBindings}
          focused
          flexGrow={1}
          backgroundColor={colors.bg.input}
          focusedBackgroundColor={colors.bg.input}
          textColor={colors.text.primary}
          placeholderColor={colors.text.muted}
        />
      </box>
      {showMenu && (
        <box
          position="absolute"
          bottom={5}
          left={0}
          right={0}
          zIndex={100}
          backgroundColor={colors.bg.input}
        >
          <CommandMenu filter={content} active={showMenu} />
        </box>
      )}
    </box>
  );
}
