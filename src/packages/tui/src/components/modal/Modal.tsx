import { useCallback, useMemo, useState } from "react";
import { TextAttributes } from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../App";
import { ModalActionBar } from "./ModalActionBar";
import type { ModalAction, ModalAnchorPoint, ModalProps } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type LayoutPos = { left?: number; right?: number; top?: number; bottom?: number; width: number };

function pointFractions(p: ModalAnchorPoint): { h: number; v: number } {
  const v = p === "top" || p.startsWith("top-") ? 0
    : p === "bottom" || p.startsWith("bottom-") ? 1
    : 0.5;
  const h = p === "left" || p.endsWith("-left") ? 0
    : p === "right" || p.endsWith("-right") ? 1
    : 0.5;
  return { h, v };
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
  anchorPosition = "bottom-left",
  position: modalPosition = "top-left",
  offset,
  matchAnchorWidth,
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
  const offsetX = offset?.x ?? 0;
  const offsetY = offset?.y ?? 0;

  const layout = useMemo<LayoutPos>(() => {
    const panelWidth = matchAnchorWidth && anchorRect ? anchorRect.width : boxWidth;

    if (anchorRect) {
      const a = pointFractions(anchorPosition);
      const m = pointFractions(modalPosition);
      const targetX = anchorRect.x + a.h * anchorRect.width + offsetX;
      const targetY = anchorRect.y + a.v * anchorRect.height + offsetY;
      const pos: LayoutPos = { width: panelWidth };

      if (m.h === 1) pos.right = Math.max(0, screenWidth - targetX);
      else if (m.h === 0.5) pos.left = Math.round(targetX - panelWidth / 2);
      else pos.left = targetX;

      if (m.v === 1) pos.bottom = Math.max(0, screenHeight - targetY);
      else if (m.v === 0.5) pos.top = Math.round(targetY - (boxHeight ?? 0) / 2);
      else pos.top = targetY;

      return pos;
    }

    const fallbackX = Math.floor((screenWidth - panelWidth) / 2);
    if (placement === "top") return { left: fallbackX, top: 2, width: panelWidth };
    if (placement === "bottom") return { left: fallbackX, bottom: 2, width: panelWidth };
    return { left: fallbackX, top: Math.floor(screenHeight / 3), width: panelWidth };
  }, [anchorRect, anchorPosition, modalPosition, matchAnchorWidth, offsetX, offsetY, placement, boxWidth, boxHeight, screenWidth, screenHeight]);

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
        onListNavigate?.((selectedListIndex - 1 + listLength) % listLength);
        return;
      }
      if (event.name === "down") {
        onListNavigate?.((selectedListIndex + 1) % listLength);
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        onListActivate?.(selectedListIndex);
        return;
      }
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
  }, [open, interactive, listLength, selectedListIndex, onListNavigate, onListActivate, moveSelection, triggerSelected, onClose]);

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
        {...layout}
        height={boxHeight}
        flexDirection="column"
        paddingTop={0}
        paddingBottom={1}
        paddingX={1}
        border
        borderStyle="single"
        borderColor={colors.border.default}
        backgroundColor={colors.bg.popup}
      >
        {title && (
          <box
            border={["bottom"]}
            borderColor={colors.decoration.subtle}
          >
            <text fg={colors.text.bright} attributes={TextAttributes.BOLD}>
              {title}
            </text>
          </box>
        )}
        <box flexGrow={1} flexDirection="column">
          {children}
        </box>
        <ModalActionBar actions={actions} selectedIndex={selectedIndex} />
      </box>
    </box>
  );
}
