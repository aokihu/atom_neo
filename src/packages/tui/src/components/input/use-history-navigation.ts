import { useCallback } from "react";
import type { RefObject } from "react";
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useInputHistory } from "../../stores/inputHistory";

export function useHistoryNavigation({
  textarea,
  navigatingRef,
}: {
  textarea: RefObject<TextareaRenderable | null>;
  navigatingRef: { current: boolean };
}) {
  const { navigateUp, navigateDown, setDraft } = useInputHistory();

  return useCallback((event: KeyEvent): boolean => {
    if (event.ctrl || event.meta) return false;

    if (event.name === "up") {
      event.preventDefault();
      const ta = textarea.current;
      if (!ta) return true;
      const result = navigateUp();
      if (result.idx === 0) setDraft(ta.plainText);
      if (result.idx >= 0) {
        navigatingRef.current = true;
        ta.replaceText(result.prev);
        navigatingRef.current = false;
      }
      return true;
    }
    if (event.name === "down") {
      event.preventDefault();
      const ta = textarea.current;
      if (!ta) return true;
      const result = navigateDown();
      navigatingRef.current = true;
      ta.replaceText(result === null ? useInputHistory.getState().draft : result.text);
      navigatingRef.current = false;
      return true;
    }
    return false;
  }, [textarea, navigateUp, navigateDown, setDraft, navigatingRef]);
}
