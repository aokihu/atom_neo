import { useRef, useCallback } from "react";
import type { RefObject } from "react";
import { TextAttributes } from "@opentui/core";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import { useTheme } from "@atom-neo/tui-kit";
import { useChatStore } from "../stores/chat";
import { CommandMenu } from "./CommandMenu";
import type { Command } from "./CommandMenu";
import { dispatchCommand, resolveCommand, useCommandMenu } from "./input/use-command-menu";
import { useDoubleEscape } from "./input/use-double-escape";
import { useInputKeyDown } from "./input/use-input-keydown";

const keyBindings: KeyBinding[] = [
  { name: "enter", action: "submit" },
  { name: "enter", shift: true, action: "newline" },
];

interface InputBarProps {
  inputRef?: RefObject<TextareaRenderable | null>;
  onSend: (text: string) => void;
  onQuit?: () => void;
  onHelp?: () => void;
  onClear?: () => void;
  onCompact?: () => void;
  onSettings?: () => void;
  onCancelTask?: () => void;
  onCancelHint?: (hint: string | null) => void;
  disabled?: boolean;
}

export { isDoubleEscape } from "./input/use-double-escape";

export function InputBar({ inputRef, onSend, onQuit, onHelp, onClear, onCompact, onSettings, onCancelTask, onCancelHint, disabled = false }: InputBarProps) {
  const { colors } = useTheme();
  const sessionBusy = useChatStore(s => s.busy);
  const internalRef = useRef<TextareaRenderable>(null);
  const taRef = inputRef ?? internalRef;
  const { content, showMenu, cmdMatches, menuSelected, push, clearInput, handleContentChange, handleMenuKey, handleHistoryKey } =
    useCommandMenu({ textarea: taRef, disabled });
  const { handleEscape } = useDoubleEscape({ busy: sessionBusy, onCancelTask, onCancelHint });

  const borderColor = sessionBusy ? colors.status.warning : colors.decoration.subtle;

  const doCommand = useCallback((cmd: Command) => {
    dispatchCommand(cmd.name, { onQuit, onHelp, onClear, onCompact, onSettings });
    clearInput();
  }, [onQuit, onHelp, onClear, onCompact, onSettings, clearInput]);

  const handleSubmit = useCallback(() => {
    if (disabled) return;
    const text = (taRef.current?.plainText ?? "").trim();
    if (!text) return;

    const cmd = resolveCommand(text);
    if (cmd) { doCommand(cmd); return; }

    push(text);
    onSend(text);
    clearInput();
  }, [disabled, onSend, push, doCommand, clearInput]);

  const handleKeyDown = useInputKeyDown({
    disabled,
    showMenu,
    sessionBusy,
    onEscape: handleEscape,
    onClear: clearInput,
    onMenuKey: handleMenuKey,
    onHistoryKey: handleHistoryKey,
  });

  return (
    <box flexShrink={0}>
      {!disabled && showMenu && cmdMatches.length > 0 && (
        <box
          position="absolute"
          bottom={8}
          left={0}
          right={1}
          zIndex={1000}
          flexDirection="column"
          paddingTop={0}
          paddingBottom={1}
          paddingX={1}
          border
          borderStyle="single"
          borderColor={colors.border.default}
          backgroundColor={colors.bg.popup}
        >
          <box border={["bottom"]} borderColor={colors.decoration.subtle}>
            <text fg={colors.text.bright} attributes={TextAttributes.BOLD}>Commands</text>
          </box>
          <CommandMenu filter={content} matches={cmdMatches} selectedIndex={menuSelected} />
        </box>
      )}
      <box
        id="input-bar"
        marginTop={1}
        marginLeft={1}
        marginRight={1}
        paddingLeft={1}
        paddingRight={1}
        paddingY={1}
        border
        borderColor={borderColor}
        borderStyle="single"
        backgroundColor={colors.bg.popup}
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
          backgroundColor={colors.bg.popup}
          focusedBackgroundColor={colors.bg.popup}
          textColor={colors.text.primary}
          placeholderColor={colors.text.muted}
        />
      </box>
    </box>
  );
}
