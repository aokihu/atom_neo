import { useRef, useCallback, useEffect } from "react";
import type { Ref } from "react";
import { useTheme } from "./App";
import { useInputHistory } from "../stores/inputHistory";
import { useChatStore } from "../stores/chat";
import type { TextareaRenderable, KeyBinding, KeyEvent, BoxRenderable } from "@opentui/core";

const keyBindings: KeyBinding[] = [
  { name: "enter", action: "submit" },
  { name: "enter", shift: true, action: "newline" },
];

interface InputBarProps {
  onSend: (text: string) => void;
  onOpenPalette?: (seed: string) => void;
  disabled?: boolean;
  anchorRef?: Ref<BoxRenderable>;
}

export function InputBar({ onSend, onOpenPalette, disabled = false, anchorRef }: InputBarProps) {
  const { colors } = useTheme();
  const sessionBusy = useChatStore(s => s.busy);
  const taRef = useRef<TextareaRenderable>(null);
  const navigatingRef = useRef(false);
  const { push, navigateUp, navigateDown, resetIndex, setDraft } = useInputHistory();

  const borderColor = sessionBusy ? colors.status.warning : colors.status.success;

  useEffect(() => { if (disabled) taRef.current?.setText(""); }, [disabled]);

  const handleContentChange = useCallback(() => {
    if (disabled) return;
    const text = taRef.current?.plainText ?? "";
    if (text.startsWith("/")) {
      taRef.current?.setText("");
      onOpenPalette?.(text);
      return;
    }
    if (navigatingRef.current) return;
    resetIndex();
  }, [disabled, onOpenPalette, resetIndex]);

  const handleSubmit = useCallback(() => {
    if (disabled) return;
    const text = (taRef.current?.plainText ?? "").trim();
    if (!text) return;
    push(text);
    onSend(text);
    taRef.current?.setText("");
  }, [disabled, onSend, push]);

  const handleKeyDown = useCallback((event: KeyEvent) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
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
  }, [disabled, navigateUp, navigateDown, setDraft]);

  return (
    <box flexShrink={0}>
      <box
        ref={anchorRef}
        marginTop={1}
        marginRight={1}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        border={["left"]}
        borderColor={borderColor}
        borderStyle="heavy"
        backgroundColor={colors.bg.codeBlock}
        flexDirection="column"
      >
        <textarea
          ref={taRef}
          placeholder="Type a message..."
          onSubmit={handleSubmit}
          onContentChange={handleContentChange}
          onKeyDown={handleKeyDown}
          keyBindings={keyBindings}
          focused={!disabled}
          height={3}
          backgroundColor={colors.bg.codeBlock}
          focusedBackgroundColor={colors.bg.codeBlock}
          textColor={colors.text.primary}
          placeholderColor={colors.text.muted}
        />
      </box>
    </box>
  );
}
