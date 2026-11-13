import { useCallback, useEffect, useRef } from "react";
import { useFocus } from "@opentui/react";
import type { BoxRenderable, TextareaRenderable } from "@opentui/core";

/** Keep exactly one app focus owner: the open modal, otherwise the input bar. */
export function useTuiFocus(modalOpen: boolean, modalKey?: unknown) {
  const inputRef = useRef<TextareaRenderable>(null);
  const modalFocusRef = useRef<BoxRenderable>(null);
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;

  const focusActive = useCallback(() => {
    (modalOpenRef.current ? modalFocusRef.current : inputRef.current)?.focus();
  }, []);

  useFocus(focusActive);

  useEffect(() => {
    if (modalOpen) inputRef.current?.blur();
    else modalFocusRef.current?.blur();
    focusActive();
  }, [modalOpen, modalKey, focusActive]);

  return { inputRef, modalFocusRef };
}
