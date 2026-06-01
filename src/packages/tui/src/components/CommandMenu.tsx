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
      marginLeft={0} marginRight={0}
      padding={1}
      borderStyle="single"
      borderColor={colors.accent.brand}
      backgroundColor={colors.bg.codeBlock}
    >
      {matches.map(cmd => (
        <box key={cmd.name} paddingLeft={1} paddingRight={2}>
          <text fg={colors.accent.brand}>{cmd.name}</text>
          <text fg={colors.text.secondary}>  {cmd.description}</text>
        </box>
      ))}
    </box>
  );
}
