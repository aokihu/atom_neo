import { useState, useCallback } from "react";

export function InputBar({ onSend }: { onSend: (text: string) => void }) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
  }, [value, onSend]);

  return (
    <box height={2} marginLeft={1} marginRight={1} marginTop={1} marginBottom={1} backgroundColor="#1c2128">
      <input
        placeholder="Message..."
        value={value}
        onInput={setValue}
        onSubmit={handleSubmit}
        focused
        flexGrow={1}
        backgroundColor="#1c2128"
        focusedBackgroundColor="#1c2128"
        textColor="#e6edf3"
        cursorColor="#58a6ff"
      />
    </box>
  );
}

