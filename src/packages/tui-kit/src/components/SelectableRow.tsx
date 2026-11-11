import type { ReactNode } from "react";
import { useTheme } from "../theme";

/**
 * Standard selectable list row: `▸` indicator, subtle selected background,
 * bright/secondary indicator colors.
 */
export function SelectableRow({
  selected,
  label,
  detail,
  labelWidth,
  muted = false,
  indicator = "▸",
  indicatorWidth = 2,
  trailing,
}: {
  selected: boolean;
  label: string;
  detail?: ReactNode;
  labelWidth?: number;
  muted?: boolean;
  indicator?: string;
  indicatorWidth?: number;
  trailing?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <box flexDirection="row" backgroundColor={selected ? colors.decoration.subtle : undefined}>
      <text fg={selected ? colors.text.bright : colors.text.secondary} width={indicatorWidth}>
        {selected ? indicator : " "}
      </text>
      <text
        fg={selected ? colors.accent.brand : muted ? colors.text.muted : colors.text.primary}
        width={labelWidth}
      >
        {label}
      </text>
      {detail != null && (
        <text fg={selected ? colors.text.bright : colors.text.primary}>{detail}</text>
      )}
      {trailing}
    </box>
  );
}
