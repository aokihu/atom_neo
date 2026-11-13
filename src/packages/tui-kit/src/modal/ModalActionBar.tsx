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
      flexShrink={0}
      flexDirection="row"
      justifyContent="flex-end"
      paddingTop={1}
    >
      {actions.map((action, index) => {
        const selected = index === selectedIndex;
        const active = selected && focused;
        const fg =
          action.variant === "danger" || action.role === "destructive"
            ? colors.status.error
            : action.variant === "primary" || action.role === "confirm"
              ? colors.accent.brand
              : colors.text.primary;
        const label = (
          <text fg={action.disabled || !focused ? colors.text.muted : fg}>
            {action.label}
          </text>
        );
        return active ? (
          <box
            key={action.key}
            id={`modal-action-${action.key}`}
            paddingX={1}
            border
            borderStyle="single"
            borderColor={colors.accent.brand}
            backgroundColor={colors.decoration.subtle}
          >
            {label}
          </box>
        ) : (
          <box key={action.key} id={`modal-action-${action.key}`} height={3} paddingX={1} justifyContent="center">
            {label}
          </box>
        );
      })}
    </box>
  );
}
