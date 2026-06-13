import { useTheme } from "./App";

export interface Command {
  name: string;
  description: string;
}

export const CMDS: Command[] = [
  { name: "/quit", description: "Exit Atom Neo" },
  { name: "/help", description: "Show help message" },
  { name: "/clear", description: "Clear chat history" },
];

function matchCommands(filter: string): Command[] {
  return CMDS
    .filter(c => c.name.includes(filter))
    .sort((a, b) => a.name.indexOf(filter) - b.name.indexOf(filter));
}

export { matchCommands };

export function CommandMenu({ filter, matches, selectedIndex }: { filter: string; matches: Command[]; selectedIndex: number }) {
  const { colors } = useTheme();

  if (matches.length === 0) {
    return (
      <box flexDirection="column"
           paddingLeft={2} paddingRight={1} paddingTop={1} paddingBottom={1}
           border={["left"]} borderColor={colors.decoration.subtle}
           backgroundColor={colors.bg.popup}>
        <text fg={colors.text.muted}>No matching commands</text>
      </box>
    );
  }

  return (
    <box flexDirection="column"
         paddingLeft={2} paddingRight={1} paddingTop={1} paddingBottom={1}
         border={["left"]} borderColor={colors.decoration.subtle}
         backgroundColor={colors.bg.popup}>
      {matches.map((cmd, i) => {
        const idx = cmd.name.indexOf(filter);
        const before = cmd.name.slice(0, idx);
        const matched = cmd.name.slice(idx, idx + filter.length);
        const after = cmd.name.slice(idx + filter.length);
        const isSelected = i === selectedIndex;
        return (
          <box key={cmd.name} flexDirection="row"
               backgroundColor={isSelected ? colors.decoration.subtle : undefined}
               paddingRight={1}>
            <box width={2}>
              {isSelected && <text fg={colors.accent.brand}>{'\u25B8'}</text>}
            </box>
            <text fg={colors.text.secondary}>{before}</text>
            <text fg={colors.accent.brand}>{matched}</text>
            <text fg={colors.text.secondary}>{after}</text>
            <text fg={colors.text.muted}>  {cmd.description}</text>
          </box>
        );
      })}
    </box>
  );
}
