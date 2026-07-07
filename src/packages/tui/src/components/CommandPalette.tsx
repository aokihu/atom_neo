import { useCallback, useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import type { KeyEvent, BoxRenderable } from "@opentui/core";
import { useKeyboard, useOnResize } from "@opentui/react";
import { Modal } from "./modal";
import type { ModalAnchorRect } from "./modal";
import { CommandMenu, matchCommands } from "./CommandMenu";
import type { Command } from "./CommandMenu";

interface CommandPaletteProps {
  open: boolean;
  initialFilter: string;
  anchorRef: RefObject<BoxRenderable | null>;
  onRun: (cmd: Command) => void;
  onClose: () => void;
}

export function CommandPalette({ open, initialFilter, anchorRef, onRun, onClose }: CommandPaletteProps) {
  const [filter, setFilter] = useState(initialFilter);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [rect, setRect] = useState<ModalAnchorRect | null>(null);

  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (el) setRect({ x: el.screenX, y: el.screenY, width: el.width, height: el.height });
  }, [anchorRef]);

  useEffect(() => {
    if (open) {
      setFilter(initialFilter);
      setSelectedIndex(0);
      measure();
    } else {
      setRect(null);
    }
  }, [open, initialFilter, measure]);

  useOnResize(() => { if (open) measure(); });

  const matches = useMemo(() => matchCommands(filter), [filter]);

  useEffect(() => {
    setSelectedIndex(i => (matches.length === 0 ? 0 : Math.min(i, matches.length - 1)));
  }, [matches.length]);

  const handleFilterKey = useCallback((event: KeyEvent) => {
    if (!open) return;
    if (event.name === "backspace") {
      setFilter(f => (f.length > 0 ? f.slice(0, -1) : f));
      return;
    }
    const ch = event.sequence;
    if (ch && ch.length === 1 && ch >= " " && !event.ctrl && !event.meta) {
      setFilter(f => f + ch);
    }
  }, [open]);

  useKeyboard(handleFilterKey);

  const activate = useCallback((index: number) => {
    const cmd = matches[index];
    if (cmd) onRun(cmd);
  }, [matches, onRun]);

  if (!open || !rect) return null;

  return (
    <Modal
      open
      title="Commands"
      anchorRect={rect}
      anchorPosition="bottom-left"
      position="bottom-left"
      matchAnchorWidth
      listLength={matches.length}
      selectedListIndex={selectedIndex}
      onListNavigate={setSelectedIndex}
      onListActivate={activate}
      onClose={onClose}
    >
      <CommandMenu filter={filter} matches={matches} selectedIndex={selectedIndex} />
    </Modal>
  );
}
