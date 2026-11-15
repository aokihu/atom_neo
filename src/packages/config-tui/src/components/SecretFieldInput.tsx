import { useState } from "react";
import { useKeyboard, usePaste } from "@opentui/react";
import { decodePasteBytes } from "@opentui/core";
import { useTheme } from "@atom-neo/tui-kit";
import { SECRET_MASK } from "../gateway-instance-form";

const CURSOR = "▌";

/**
 * Masked single-line secret input.
 *
 * The raw value lives only in local state and is never rendered: the visible
 * field is always a fixed-width bullet mask. Keys are handled here because the
 * surrounding Modal is rendered with `interactive={false}`.
 */
export function SecretFieldInput({ label, placeholder, error, initialValue = "", onSubmit, onCancel }: {
  label: string;
  placeholder?: string;
  error?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [value, setValue] = useState(initialValue);

  useKeyboard((event) => {
    if (event.name === "escape") {
      onCancel();
      return;
    }
    if (event.ctrl || event.meta || event.option || event.super) return;
    if (event.name === "return" || event.name === "enter") {
      onSubmit(value);
      return;
    }
    if (event.name === "backspace") {
      setValue((prev) => prev.slice(0, -1));
      return;
    }
    if (event.name === "space" || event.sequence === " ") {
      setValue((prev) => prev + " ");
      return;
    }
    if (event.name === "tab" || event.name.startsWith("arrow")) return;
    if (event.name.length === 1) setValue((prev) => prev + event.sequence);
  });

  usePaste((event) => {
    const text = decodePasteBytes(event.bytes).replace(/[\r\n]+/g, "");
    if (text) setValue((prev) => prev + text);
  });

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
        <box flexDirection="row">
          <text fg={value === "" ? colors.text.muted : colors.text.primary}>
            {value === "" ? placeholder ?? "" : SECRET_MASK}
          </text>
          <text fg={colors.text.bright}>{CURSOR}</text>
        </box>
      </box>
      {error ? (
        <box marginTop={1}>
          <text fg={colors.status.error}>{error}</text>
        </box>
      ) : null}
    </box>
  );
}
