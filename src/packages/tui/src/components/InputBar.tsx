import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useTheme } from "./App";
import { CommandMenu, CMDS, matchCommands } from "./CommandMenu";
import type { Command } from "./CommandMenu";
import { useInputHistory } from "../stores/inputHistory";
import { useChatStore } from "../stores/chat";
import type { TextareaRenderable, KeyBinding, KeyEvent } from "@opentui/core";

const keyBindings: KeyBinding[] = [
  { name: "enter", action: "submit" },
  { name: "enter", shift: true, action: "newline" },
];

function resolveCommand(text: string): Command | null {
  return CMDS.find(c => c.name === text) ?? null;
}

interface InputBarProps {
  onSend: (text: string) => void;
  onQuit?: () => void;
  onHelp?: () => void;
  onClear?: () => void;
  onCompact?: () => void;
  disabled?: boolean;
}

export function InputBar({ onSend, onQuit, onHelp, onClear, onCompact, disabled = false }: InputBarProps) {
  const { colors } = useTheme();
  const sessionBusy = useChatStore(s => s.busy);
  const taRef = useRef<TextareaRenderable>(null);
  const [content, setContent] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigatingRef = useRef(false);
  const selectedIndexRef = useRef(0);
  const { push, navigateUp, navigateDown, resetIndex, setDraft } = useInputHistory();

  const showMenu = content.startsWith("/");
  const borderColor = sessionBusy ? colors.status.warning : colors.status.success;

  const cmdMatches = useMemo(() => {
    if (!showMenu || content.length < 1) return [];
    return matchCommands(content);
  }, [content, showMenu]);

  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);

  useEffect(() => {
    setSelectedIndex(0);
    selectedIndexRef.current = 0;
  }, [content]);

  const handleContentChange = useCallback(() => {
    setContent(taRef.current?.plainText ?? "");
    if (navigatingRef.current) return;
    resetIndex();
  }, [resetIndex]);

  const doAutocomplete = useCallback((matches: Command[]) => {
    const idx = Math.min(selectedIndexRef.current, matches.length - 1);
    const cmd = matches[idx];
    taRef.current?.setText(cmd.name);
  }, []);

  const doCommand = useCallback((cmd: Command) => {
    switch (cmd.name) {
      case "/quit":
        onQuit?.();
        break;
      case "/help":
        onHelp?.();
        break;
      case "/clear":
        onClear?.();
        break;
      case "/compact":
        onCompact?.();
        break;
    }
    taRef.current?.setText("");
    setContent("");
  }, [onQuit, onHelp, onClear, onCompact]);

  const handleSubmit = useCallback(() => {
    if (disabled) return;
    const text = (taRef.current?.plainText ?? "").trim();
    if (!text) return;

    const cmd = resolveCommand(text);
    if (cmd) {
      doCommand(cmd);
      return;
    }

    if (showMenu && cmdMatches.length > 0) {
      doAutocomplete(cmdMatches);
      return;
    }

    push(text);
    onSend(text);
    taRef.current?.setText("");
    setContent("");
  }, [disabled, showMenu, cmdMatches, onSend, push, doCommand, doAutocomplete]);

  const handleKeyDown = useCallback((event: KeyEvent) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (event.name === "escape" && showMenu) {
      event.preventDefault();
      taRef.current?.setText("");
      setContent("");
      return;
    }

    if (showMenu && cmdMatches.length > 0) {
      if (event.name === "tab") {
        event.preventDefault();
        doAutocomplete(cmdMatches);
        return;
      }
      if (event.name === "up") {
        event.preventDefault();
        setSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (event.name === "down") {
        event.preventDefault();
        setSelectedIndex(prev => Math.min(cmdMatches.length - 1, prev + 1));
        return;
      }
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
  }, [disabled, showMenu, cmdMatches, navigateUp, navigateDown, setDraft, doAutocomplete]);

  return (
    <box flexShrink={0}>
      <box
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
      {showMenu && (
        <box
          position="absolute"
          bottom={5}
          left={0}
          right={1}
          zIndex={100}
        >
          <CommandMenu filter={content} matches={cmdMatches} selectedIndex={selectedIndex} />
        </box>
      )}
    </box>
  );
}
