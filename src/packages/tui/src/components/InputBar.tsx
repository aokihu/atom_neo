import { useState, useRef, useCallback } from "react";
import { useTheme } from "./App";
import type { TextareaRenderable, BorderCharacters } from "@opentui/core";

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

const keyBindings = [
  { name: "enter", action: "submit" },
  { name: "enter", shift: true, action: "newline" },
];

export function InputBar({ onSend }: { onSend: (text: string) => void }) {
  const { colors } = useTheme();
  const taRef = useRef<TextareaRenderable>(null);
  const [resetKey, setResetKey] = useState(0);

  const handleSubmit = useCallback(() => {
    const text = taRef.current?.plainText?.trim();
    if (!text) return;
    onSend(text);
    setResetKey(k => k + 1);
  }, [onSend]);

  return (
    <box
      height={6}
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
        placeholder="Message... (Shift+Enter for newline)"
        initialValue=""
        onSubmit={handleSubmit}
        keyBindings={keyBindings}
        focused
        flexGrow={1}
        backgroundColor={colors.bg.input}
        focusedBackgroundColor={colors.bg.input}
        textColor={colors.text.primary}
        placeholderColor={colors.text.muted}
      />
    </box>
  );
}
