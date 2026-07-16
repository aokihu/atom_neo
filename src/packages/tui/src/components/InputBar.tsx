import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { TextAttributes } from "@opentui/core";
import type { KeyBinding, KeyEvent, TextareaRenderable } from "@opentui/core";
import { useTheme } from "./App";
import { useInputHistory } from "../stores/inputHistory";
import { useChatStore } from "../stores/chat";
import { CommandMenu, CMDS, matchCommands } from "./CommandMenu";
import type { Command } from "./CommandMenu";

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
  onCancelTask?: () => void;
  onCancelHint?: (hint: string | null) => void;
  disabled?: boolean;
}

export function isDoubleEscape(lastPressTime: number, now: number, windowMs = 2000): boolean {
  return lastPressTime > 0 && now - lastPressTime < windowMs;
}

export function InputBar({ onSend, onQuit, onHelp, onClear, onCompact, onCancelTask, onCancelHint, disabled = false }: InputBarProps) {
  const { colors } = useTheme();
  const sessionBusy = useChatStore(s => s.busy);
  const taRef = useRef<TextareaRenderable>(null);
  const [content, setContent] = useState("");
  const [menuSelected, setMenuSelected] = useState(0);
  const navigatingRef = useRef(false);
  const menuSelectedRef = useRef(0);
  const fillFlag = useRef(0);
  const lastCancelPressRef = useRef(0);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { push, navigateUp, navigateDown, resetIndex, setDraft } = useInputHistory();

  const [filter, setFilter] = useState("");

  const showMenu = filter.startsWith("/");
  const borderColor = sessionBusy ? colors.status.warning : colors.status.success;

  const cmdMatches = useMemo(() => {
    if (!showMenu || filter.length < 1) return [];
    return matchCommands(filter);
  }, [filter, showMenu]);

  useEffect(() => { menuSelectedRef.current = menuSelected; }, [menuSelected]);

  useEffect(() => { if (disabled) taRef.current?.setText(""); }, [disabled]);
  useEffect(() => {
    if (sessionBusy) return;
    lastCancelPressRef.current = 0;
    if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
    cancelTimerRef.current = null;
    onCancelHint?.(null);
  }, [sessionBusy, onCancelHint]);
  useEffect(() => () => {
    if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
  }, []);

  const handleContentChange = useCallback(() => {
    if (disabled) return;
    const text = taRef.current?.plainText ?? "";
    setContent(text);
    if (fillFlag.current > 0) { fillFlag.current--; return; }
    setFilter(text);
    setMenuSelected(0);
    menuSelectedRef.current = 0;
    if (navigatingRef.current) return;
    resetIndex();
  }, [disabled, resetIndex]);

  const doCommand = useCallback((cmd: Command) => {
    switch (cmd.name) {
      case "/quit": onQuit?.(); break;
      case "/help": onHelp?.(); break;
      case "/clear": onClear?.(); break;
      case "/compact": onCompact?.(); break;
    }
    taRef.current?.setText("");
    setContent("");
    setFilter("");
  }, [onQuit, onHelp, onClear, onCompact]);

  const handleSubmit = useCallback(() => {
    if (disabled) return;
    const text = (taRef.current?.plainText ?? "").trim();
    if (!text) return;

    const cmd = resolveCommand(text);
    if (cmd) { doCommand(cmd); return; }

    push(text);
    onSend(text);
    taRef.current?.setText("");
    setContent("");
    setFilter("");
  }, [disabled, onSend, push, doCommand]);

  const handleKeyDown = useCallback((event: KeyEvent) => {
    if (disabled) { event.preventDefault(); return; }

    if (event.name === "escape" && showMenu) {
      event.preventDefault();
      taRef.current?.setText("");
      setContent("");
      setFilter("");
      return;
    }

    if (event.name === "escape" && sessionBusy) {
      event.preventDefault();
      const now = Date.now();
      if (isDoubleEscape(lastCancelPressRef.current, now)) {
        lastCancelPressRef.current = 0;
        if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
        cancelTimerRef.current = null;
        onCancelHint?.("Cancelling current task...");
        onCancelTask?.();
        return;
      }

      lastCancelPressRef.current = now;
      if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
      cancelTimerRef.current = setTimeout(() => {
        lastCancelPressRef.current = 0;
        cancelTimerRef.current = null;
        onCancelHint?.(null);
      }, 2000);
      onCancelHint?.("Press ESC again within 2s to cancel current task");
      return;
    }

    if (showMenu && cmdMatches.length > 0) {
      if (event.name === "tab") {
        event.preventDefault();
        fillFlag.current++;
        const idx = menuSelectedRef.current;
        taRef.current?.setText(cmdMatches[idx]?.name ?? "");
        return;
      }
      if (event.name === "up") {
        event.preventDefault();
        fillFlag.current++;
        const next = Math.max(0, menuSelectedRef.current - 1);
        menuSelectedRef.current = next;
        setMenuSelected(next);
        taRef.current?.setText(cmdMatches[next]?.name ?? "");
        return;
      }
      if (event.name === "down") {
        event.preventDefault();
        fillFlag.current++;
        const next = Math.min(cmdMatches.length - 1, menuSelectedRef.current + 1);
        menuSelectedRef.current = next;
        setMenuSelected(next);
        taRef.current?.setText(cmdMatches[next]?.name ?? "");
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
  }, [disabled, showMenu, sessionBusy, cmdMatches, navigateUp, navigateDown, setDraft, onCancelTask, onCancelHint]);

  return (
    <box flexShrink={0}>
      {showMenu && cmdMatches.length > 0 && (
        <box
          position="absolute"
          bottom={6}
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
