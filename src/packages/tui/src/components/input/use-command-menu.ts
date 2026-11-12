import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useInputHistory } from "../../stores/inputHistory";
import { matchCommands } from "../CommandMenu";
import { useHistoryNavigation } from "./use-history-navigation";

export { dispatchCommand, resolveCommand } from "./commands";
export type { CommandHandlers } from "./commands";

export function useCommandMenu({
  textarea,
  disabled,
}: {
  textarea: RefObject<TextareaRenderable | null>;
  disabled: boolean;
}) {
  const [content, setContent] = useState("");
  const [menuSelected, setMenuSelected] = useState(0);
  const [filter, setFilter] = useState("");
  const menuSelectedRef = useRef(0);
  const navigatingRef = useRef(false);
  const fillFlag = useRef(0);
  const { push, resetIndex } = useInputHistory();
  const handleHistoryKey = useHistoryNavigation({ textarea, navigatingRef });

  const showMenu = filter.startsWith("/");
  const cmdMatches = useMemo(() => {
    if (!showMenu || filter.length < 1) return [];
    return matchCommands(filter);
  }, [filter, showMenu]);

  useEffect(() => { menuSelectedRef.current = menuSelected; }, [menuSelected]);

  const clearInput = useCallback(() => {
    textarea.current?.setText("");
    setContent("");
    setFilter("");
  }, [textarea]);

  const handleContentChange = useCallback(() => {
    if (disabled) return;
    const text = textarea.current?.plainText ?? "";
    setContent(text);
    if (fillFlag.current > 0) { fillFlag.current--; return; }
    setFilter(text);
    setMenuSelected(0);
    menuSelectedRef.current = 0;
    if (navigatingRef.current) return;
    resetIndex();
  }, [disabled, textarea, resetIndex]);

  const handleMenuKey = useCallback((event: KeyEvent): boolean => {
    if (!showMenu || cmdMatches.length === 0) return false;

    if (event.name === "tab") {
      event.preventDefault();
      fillFlag.current++;
      textarea.current?.setText(cmdMatches[menuSelectedRef.current]?.name ?? "");
      return true;
    }
    if (event.name === "up") {
      event.preventDefault();
      fillFlag.current++;
      const next = Math.max(0, menuSelectedRef.current - 1);
      menuSelectedRef.current = next;
      setMenuSelected(next);
      textarea.current?.setText(cmdMatches[next]?.name ?? "");
      return true;
    }
    if (event.name === "down") {
      event.preventDefault();
      fillFlag.current++;
      const next = Math.min(cmdMatches.length - 1, menuSelectedRef.current + 1);
      menuSelectedRef.current = next;
      setMenuSelected(next);
      textarea.current?.setText(cmdMatches[next]?.name ?? "");
      return true;
    }
    return true;
  }, [showMenu, cmdMatches, textarea]);

  return {
    content,
    showMenu,
    cmdMatches,
    menuSelected,
    push,
    clearInput,
    handleContentChange,
    handleMenuKey,
    handleHistoryKey,
  };
}
