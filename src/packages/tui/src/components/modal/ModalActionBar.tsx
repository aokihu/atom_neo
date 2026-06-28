import { useTheme } from "../App";
import type { ModalAction } from "./types";

interface ModalActionBarProps {
  actions: ModalAction[];
  selectedIndex: number;
}

export function ModalActionBar({ actions, selectedIndex }: ModalActionBarProps) {
  const { colors } = useTheme();
  if (actions.length === 0) return null;
  return (
    <box
      flexDirection="row"
      justifyContent="flex-end"
      paddingTop={1}
      border={["top"]}
      borderColor={colors.decoration.subtle}
    >
      {actions.map((action, index) => {
        const selected = index === selectedIndex;
        const fg =
          action.variant === "danger" || action.role === "destructive"
            ? colors.status.error
            : action.variant === "primary" || action.role === "confirm"
              ? colors.accent.brand
              : colors.text.primary;
        return (
          <box
            key={action.key}
            marginLeft={1}
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={selected ? colors.decoration.subtle : undefined}
          >
            <text fg={action.disabled ? colors.text.muted : fg}>
              {action.label}
            </text>
          </box>
        );
      })}
    </box>
  );
}
