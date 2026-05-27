import { useState, useCallback } from "react";
import { useTheme } from "./App";

export function InputBar({ onSend }: { onSend: (text: string) => void }) {
  const { colors } = useTheme();
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
  }, [value, onSend]);

  return (
    <box height={2} marginLeft={1} marginRight={1} marginTop={1} marginBottom={1} backgroundColor={colors.bg.input}>
      <input
        placeholder="Message..."
        value={value}
        onInput={setValue}
        onSubmit={handleSubmit}
        focused
        flexGrow={1}
        backgroundColor={colors.bg.input}
        focusedBackgroundColor={colors.bg.input}
        textColor={colors.text.primary}
        cursorColor={colors.accent.brand}
      />
    </box>
  );
}
