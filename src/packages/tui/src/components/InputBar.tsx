import { useState, useRef, useCallback } from "react";
import { useTheme } from "./App";
import { CommandMenu } from "./CommandMenu";
import type { TextareaRenderable, BorderCharacters, KeyBinding } from "@opentui/core";

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
  const [resetKey, setResetKey] = useState(0);
  const [content, setContent] = useState("");

  const showMenu = content.startsWith("/");

  const handleContentChange = useCallback(() => {
    const text = taRef.current?.plainText ?? "";
    setContent(text);
  }, []);

  const handleSubmit = useCallback(() => {
    const text = taRef.current?.plainText?.trim();
    if (!text) return;

    if (text === "/quit") {
      onQuit?.();
      setContent("");
      setResetKey(k => k + 1);
      return;
    }

    onSend(text);
    setContent("");
    setResetKey(k => k + 1);
  }, [onSend, onQuit]);

  return (
    <box>
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
          key={resetKey}
          ref={taRef}
          placeholder="Message... (Shift+Enter for newline, / for commands)"
          initialValue=""
          onSubmit={handleSubmit}
          onContentChange={handleContentChange}
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
