import { useEffect, useRef } from "react";
import type { KeyBinding, KeyEvent, TextareaRenderable } from "@opentui/core";
import { useTheme } from "../theme";

const keyBindings: KeyBinding[] = [
  { name: "enter", action: "submit" },
];

/** Single-line form field rendered inside a modal: Enter submits, Esc cancels. */
export function FieldInput({ label, value, placeholder, error, onSubmit, onCancel }: {
  label: string;
  value: string;
  placeholder?: string;
  error?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const taRef = useRef<TextareaRenderable>(null);

  useEffect(() => {
    taRef.current?.setText(value);
  }, []);

  const handleKeyDown = (event: KeyEvent) => {
    if (event.name === "escape") onCancel();
  };

  const handleSubmit = () => {
    onSubmit((taRef.current?.plainText ?? "").trim());
  };

  return (
    <box flexDirection="column">
      <box marginBottom={1}>
        <text fg={colors.text.secondary}>{label}</text>
      </box>
      <box
        border
        borderStyle="single"
        borderColor={colors.border.default}
        paddingX={1}
        backgroundColor={colors.bg.input}
      >
        <textarea
          ref={taRef}
          placeholder={placeholder ?? ""}
          onSubmit={handleSubmit}
          onContentChange={() => {}}
          onKeyDown={handleKeyDown}
          keyBindings={keyBindings}
          focused
          height={1}
          backgroundColor={colors.bg.input}
          focusedBackgroundColor={colors.bg.input}
          textColor={colors.text.primary}
          placeholderColor={colors.text.muted}
        />
      </box>
      {error ? (
        <box marginTop={1}>
          <text fg={colors.status.error}>{error}</text>
        </box>
      ) : null}
    </box>
  );
}
