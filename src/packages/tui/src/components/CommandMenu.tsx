import { useEffect, useRef } from "react";
import { useTheme } from "./App";
import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";

export interface Command {
  name: string;
  description: string;
}

export const CMDS: Command[] = [
  { name: "/quit", description: "Exit Atom Neo" },
  { name: "/help", description: "Show help message" },
  { name: "/clear", description: "Clear chat history" },
  { name: "/compact", description: "Compress session context" },
];

function matchCommands(filter: string): Command[] {
  return [...CMDS]
    .filter(c => c.name.includes(filter))
    .sort((a, b) => a.name.indexOf(filter) - b.name.indexOf(filter));
}

export { matchCommands };

export function CommandMenu({ filter, matches, selectedIndex }: { filter: string; matches: Command[]; selectedIndex: number }) {
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb) return;
    const visible = sb.height;
    const target = Math.max(0, selectedIndex - visible + 1);
    sb.scrollTop = target;
  }, [selectedIndex]);

  if (matches.length === 0) {
    return (
      <box flexDirection="column" backgroundColor={colors.bg.popup}>
        <text fg={colors.text.muted}>No matching commands</text>
      </box>
    );
  }

  return (
    <scrollbox ref={scrollRef} flexDirection="column" height={8} backgroundColor={colors.bg.popup}>
      {matches.map((cmd, i) => {
        const isSelected = i === selectedIndex;
        const nameFg = isSelected ? colors.text.bright : colors.text.secondary;
        const matchFg = isSelected ? colors.text.bright : colors.accent.brand;
        const descFg = isSelected ? colors.text.bright : colors.text.muted;
        const idx = cmd.name.indexOf(filter);
        const hasMatch = idx >= 0 && filter.length > 0;
        const before = hasMatch ? cmd.name.slice(0, idx) : cmd.name;
        const matched = hasMatch ? cmd.name.slice(idx, idx + filter.length) : "";
        const after = hasMatch ? cmd.name.slice(idx + filter.length) : "";
        return (
          <box
            key={cmd.name}
            flexDirection="row"
            backgroundColor={isSelected ? colors.accent.brand : undefined}
          >
            {hasMatch ? (
              <>
                {before && <text fg={nameFg} attributes={TextAttributes.BOLD}>{before}</text>}
                <text fg={matchFg} attributes={TextAttributes.BOLD}>{matched}</text>
                {after && <text fg={nameFg} attributes={TextAttributes.BOLD}>{after}</text>}
              </>
            ) : (
              <text fg={nameFg} attributes={TextAttributes.BOLD}>{before}</text>
            )}
            <text fg={descFg}>  {cmd.description}</text>
          </box>
        );
      })}
    </scrollbox>
  );
}
