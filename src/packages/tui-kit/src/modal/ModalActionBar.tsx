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
        const labelWidth = Array.from(action.label).length;
        const minWidth = labelWidth % 2 === 0 ? 5 : 6;
        const naturalWidth = Math.max(minWidth, labelWidth);
        const contentWidth = naturalWidth + (naturalWidth - labelWidth) % 2;
        const fg =
          action.variant === "danger" || action.role === "destructive"
            ? colors.status.error
            : action.variant === "primary" || action.role === "confirm"
              ? colors.accent.brand
              : colors.text.primary;
        return (
          <box
            key={action.key}
            id={`modal-action-${action.key}`}
            paddingX={1}
            border
            borderStyle="single"
            borderColor={active ? colors.accent.brand : colors.bg.popup}
            backgroundColor={active ? colors.decoration.subtle : undefined}
          >
            <box id={`modal-action-label-${action.key}`} minWidth={contentWidth} flexDirection="row" justifyContent="center">
              <text fg={action.disabled || !focused ? colors.text.muted : fg}>
                {action.label}
              </text>
            </box>
          </box>
        );
      })}
    </box>
  );
}
