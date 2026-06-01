import { useMemo } from "react";
import { useTheme } from "./App";

interface Command {
  name: string;
  description: string;
}

const CMDS: Command[] = [
  { name: "/quit", description: "Exit Atom Neo" },
];

export function CommandMenu({ filter, active }: { filter: string; active: boolean }) {
  const { colors } = useTheme();

  const matches = useMemo(() => {
    if (!active) return [];
    return CMDS.filter(c => c.name.startsWith(filter));
  }, [filter, active]);

  if (matches.length === 0) return null;

  return (
    <box
      flexDirection="column"
      paddingLeft={2} paddingRight={1} paddingTop={1} paddingBottom={1}
      border={["left"]}
      borderColor={colors.decoration.subtle}
      backgroundColor={colors.bg.input}
    >
      {matches.map(cmd => (
        <box key={cmd.name} flexDirection="row">
          <text fg={colors.accent.brand}>{cmd.name}</text>
          <text fg={colors.text.muted}>  {cmd.description}</text>
        </box>
      ))}
    </box>
  );
}
