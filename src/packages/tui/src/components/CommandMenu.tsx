import { useTheme } from "./App";
import { TextAttributes } from "@opentui/core";

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
  return [...CMDS];
}

export { matchCommands };

export function CommandMenu({ filter, matches, selectedIndex }: { filter: string; matches: Command[]; selectedIndex: number }) {
  const { colors } = useTheme();

  if (matches.length === 0) {
    return (
      <box flexDirection="column"
           backgroundColor={colors.bg.popup}>
        <text fg={colors.text.muted}>No matching commands</text>
      </box>
    );
  }

  return (
    <box flexDirection="column"
         backgroundColor={colors.bg.popup}>
      {matches.map((cmd, i) => {
        const isSelected = i === selectedIndex;
        const nameFg = isSelected ? colors.text.bright : colors.text.secondary;
        const matchFg = isSelected ? colors.text.bright : colors.accent.brand;
        const descFg = isSelected ? colors.text.bright : colors.text.muted;
        const idx = cmd.name.indexOf(filter);
        const before = idx >= 0 ? cmd.name.slice(0, idx) : cmd.name;
        const matched = idx >= 0 ? cmd.name.slice(idx, idx + filter.length) : "";
        const after = idx >= 0 ? cmd.name.slice(idx + filter.length) : "";
        return (
          <box
            key={cmd.name}
            flexDirection="row"
            backgroundColor={isSelected ? colors.accent.brand : undefined}
          >
            <text fg={nameFg} attributes={TextAttributes.BOLD}>{before}</text>
            <text fg={matchFg} attributes={TextAttributes.BOLD}>{matched}</text>
            <text fg={nameFg} attributes={TextAttributes.BOLD}>{after}</text>
            <text fg={descFg}>  {cmd.description}</text>
          </box>
        );
      })}
    </box>
  );
}
