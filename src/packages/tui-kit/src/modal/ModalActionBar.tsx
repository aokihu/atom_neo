import { useTheme } from "../theme";
import type { ModalAction } from "./types";

interface ModalActionBarProps {
  actions: ModalAction[];
  selectedIndex: number;
  focused?: boolean;
}

export function ModalActionBar({ actions, selectedIndex, focused = true }: ModalActionBarProps) {
  const { colors } = useTheme();
  if (actions.length === 0) return null;
  return (
    <box
      flexDirection="row"
      justifyContent="flex-end"
      paddingTop={1}
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
            paddingX={2}
            backgroundColor={selected && focused ? colors.decoration.subtle : undefined}
          >
            <text fg={action.disabled || !focused ? colors.text.muted : fg}>
              {action.label}
            </text>
          </box>
        );
      })}
    </box>
  );
}
