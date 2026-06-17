import { memo } from "react";
import { useTheme } from "./App";

export const ThinkingSpinner = memo(function ThinkingSpinner() {
  const { colors } = useTheme();

  return (
    <box paddingLeft={2} flexDirection="row" alignItems="center">
      <spinner name="dots" color={colors.accent.brand} />
      <text marginLeft={1} fg={colors.text.muted}>thinking</text>
    </box>
  );
});
