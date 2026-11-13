import { useCallback } from "react";
import type { KeyEvent } from "@opentui/core";

export function useInputKeyDown({
  disabled,
  showMenu,
  sessionBusy,
  onEscape,
  onClear,
  onMenuKey,
  onHistoryKey,
}: {
  disabled: boolean;
  showMenu: boolean;
  sessionBusy: boolean;
  onEscape: () => void;
  onClear: () => void;
  onMenuKey: (event: KeyEvent) => boolean;
  onHistoryKey: (event: KeyEvent) => boolean;
}) {
  return useCallback((event: KeyEvent) => {
    if (disabled) { event.preventDefault(); return; }

    if (event.name === "escape" && showMenu) {
      event.preventDefault();
      onClear();
      return;
    }

    if (event.name === "escape" && sessionBusy) {
      event.preventDefault();
      onEscape();
      return;
    }

    if (onMenuKey(event)) return;
    if (event.ctrl || event.meta) return;
    onHistoryKey(event);
  }, [disabled, showMenu, sessionBusy, onEscape, onClear, onMenuKey, onHistoryKey]);
}
