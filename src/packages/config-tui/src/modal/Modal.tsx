import { useCallback, useEffect, useMemo, useState } from "react";
import { TextAttributes } from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../theme";
import { ModalActionBar } from "./ModalActionBar";
import type { ModalAction, ModalProps } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function findInitialIndex(actions: ModalAction[], defaultActionKey?: string) {
  if (actions.length === 0) return -1;
  const byKey = defaultActionKey
    ? actions.findIndex(a => a.key === defaultActionKey && !a.disabled)
    : -1;
  if (byKey >= 0) return byKey;
  const confirm = actions.findIndex(a => (a.role === "confirm" || a.variant === "primary") && !a.disabled);
  if (confirm >= 0) return confirm;
  const firstEnabled = actions.findIndex(a => !a.disabled);
  return firstEnabled >= 0 ? firstEnabled : 0;
}

export function Modal({
  open,
  title,
  width = 60,
  height,
  actions = [],
  defaultActionKey,
  children,
  zIndex = 1000,
  onAction,
  onClose,
  listLength,
  selectedListIndex = 0,
  onListNavigate,
  onListActivate,
  interactive = true,
  hint,
}: ModalProps) {
  const { colors } = useTheme();
  const { width: screenWidth, height: screenHeight } = useTerminalDimensions();

  const initialIndex = useMemo(
    () => findInitialIndex(actions, defaultActionKey),
    [actions, defaultActionKey],
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [actionFocus, setActionFocus] = useState(false);

  useEffect(() => { if (!open) setActionFocus(false); }, [open]);

  const boxWidth = clamp(width, 20, Math.max(20, screenWidth - 4));
  const left = Math.max(0, Math.floor((screenWidth - boxWidth) / 2));
  const top = Math.max(1, Math.floor(screenHeight / 4));
  const boxHeight = height
    ? clamp(height, 6, Math.max(6, screenHeight - top - 2))
    : undefined;

  const moveSelection = useCallback((direction: 1 | -1) => {
    if (actions.length === 0) return;
    setSelectedIndex(prev => {
      let next = prev;
      for (let i = 0; i < actions.length; i++) {
        next = (next + direction + actions.length) % actions.length;
        if (!actions[next]?.disabled) return next;
      }
      return prev;
    });
  }, [actions]);

  const triggerSelected = useCallback(() => {
    if (selectedIndex < 0) return;
    const action = actions[selectedIndex];
    if (!action || action.disabled) return;
    onAction?.(action.key, action);
  }, [actions, selectedIndex, onAction]);

  const handleKeyDown = useCallback((event: KeyEvent) => {
    if (!open || !interactive) return;
    if (event.name === "escape") {
      onClose?.();
      return;
    }

    if (listLength != null && listLength > 0) {
      if (event.name === "up") {
        setActionFocus(false);
        onListNavigate?.((selectedListIndex - 1 + listLength) % listLength);
        return;
      }
      if (event.name === "down") {
        setActionFocus(false);
        onListNavigate?.((selectedListIndex + 1) % listLength);
        return;
      }
      if ((event.name === "return" || event.name === "enter") && !actionFocus) {
        onListActivate?.(selectedListIndex);
        return;
      }
    }

    if (event.name === "tab" || event.name === "right") {
      if (actions.length > 0) setActionFocus(true);
      if (listLength == null || listLength === 0 || event.name === "right") moveSelection(1);
      return;
    }
    if (event.name === "left") {
      if (actions.length > 0) setActionFocus(true);
      moveSelection(-1);
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      triggerSelected();
    }
  }, [open, interactive, listLength, selectedListIndex, actionFocus, onListNavigate, onListActivate, actions.length, moveSelection, triggerSelected, onClose]);

  useKeyboard(handleKeyDown);

  if (!open) return null;

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={zIndex}
    >
      <box
        position="absolute"
        left={left}
        top={top}
        width={boxWidth}
        height={boxHeight}
        flexDirection="column"
        border
        borderStyle="single"
        borderColor={colors.border.default}
        paddingTop={0}
        paddingBottom={1}
        paddingX={1}
        backgroundColor={colors.bg.popup}
      >
        {title && (
          <box paddingY={1}>
            <text fg={colors.text.bright} attributes={TextAttributes.BOLD}>
              {title}
            </text>
          </box>
        )}
        <box flexGrow={1} flexDirection="column" paddingX={1}>
          {children}
        </box>
        <ModalActionBar
          actions={actions}
          selectedIndex={selectedIndex}
          focused={listLength == null || listLength === 0 || actionFocus}
        />
        {hint && (
          <box paddingTop={1}>
            <text fg={colors.text.muted}>{hint}</text>
          </box>
        )}
      </box>
    </box>
  );
}
