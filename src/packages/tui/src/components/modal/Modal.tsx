import { useCallback, useMemo, useState } from "react";
import { TextAttributes } from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../App";
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
  const confirm = actions.findIndex(
    a => (a.role === "confirm" || a.variant === "primary") && !a.disabled,
  );
  if (confirm >= 0) return confirm;
  const firstEnabled = actions.findIndex(a => !a.disabled);
  return firstEnabled >= 0 ? firstEnabled : 0;
}

export function Modal({
  open,
  title,
  width = 60,
  height,
  placement = "center",
  anchorRect,
  actions = [],
  defaultActionKey,
  children,
  zIndex = 1000,
  onAction,
  onClose,
}: ModalProps) {
  const { colors } = useTheme();
  const { width: screenWidth, height: screenHeight } = useTerminalDimensions();

  const initialIndex = useMemo(
    () => findInitialIndex(actions, defaultActionKey),
    [actions, defaultActionKey],
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  const boxWidth = clamp(width, 20, Math.max(20, screenWidth - 4));
  const boxHeight = height;

  const position = useMemo(() => {
    const fallbackX = Math.floor((screenWidth - boxWidth) / 2);
    const fallbackY = Math.floor(screenHeight / 3);
    if (!anchorRect) {
      if (placement === "top") {
        return { left: fallbackX, top: 2 };
      }
      if (placement === "bottom") {
        return { left: fallbackX, bottom: 2 };
      }
      return { left: fallbackX, top: fallbackY };
    }
    switch (placement) {
      case "attach-top":
        return {
          left: clamp(anchorRect.x, 0, screenWidth - boxWidth),
          top: Math.max(0, anchorRect.y - (boxHeight ?? 8)),
        };
      case "attach-bottom":
        return {
          left: clamp(anchorRect.x, 0, screenWidth - boxWidth),
          top: clamp(anchorRect.y + anchorRect.height, 0, screenHeight - 3),
        };
      case "attach-left":
        return {
          left: Math.max(0, anchorRect.x - boxWidth),
          top: clamp(anchorRect.y, 0, screenHeight - 3),
        };
      case "attach-right":
        return {
          left: clamp(anchorRect.x + anchorRect.width, 0, screenWidth - boxWidth),
          top: clamp(anchorRect.y, 0, screenHeight - 3),
        };
      default:
        return { left: fallbackX, top: fallbackY };
    }
  }, [placement, anchorRect, screenWidth, screenHeight, boxWidth, boxHeight]);

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
    if (!open) return;
    if (event.name === "escape") {
      onClose?.();
      return;
    }
    if (event.name === "tab" || event.name === "right") {
      moveSelection(1);
      return;
    }
    if (event.name === "left") {
      moveSelection(-1);
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      triggerSelected();
    }
  }, [open, moveSelection, triggerSelected, onClose]);

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
        {...position}
        width={boxWidth}
        height={boxHeight}
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        border
        borderStyle="single"
        borderColor={colors.border.default}
        backgroundColor={colors.bg.popup}
      >
        {title && (
          <box
            paddingBottom={1}
            border={["bottom"]}
            borderColor={colors.decoration.subtle}
          >
            <text fg={colors.text.bright} attributes={TextAttributes.BOLD}>
              {title}
            </text>
          </box>
        )}
        <box flexGrow={1} flexDirection="column" paddingTop={1} paddingBottom={1}>
          {children}
        </box>
        <ModalActionBar actions={actions} selectedIndex={selectedIndex} />
      </box>
    </box>
  );
}
