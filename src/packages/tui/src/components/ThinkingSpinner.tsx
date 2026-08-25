import { memo } from "react";
import { BounceBarSpinner } from "./BounceBarSpinner";
import { useTheme } from "./App";

export const ThinkingSpinner = memo(function ThinkingSpinner() {
  const { colors } = useTheme();

  return (
    <box paddingLeft={2} flexDirection="row" alignItems="center">
      <BounceBarSpinner />
      <text marginLeft={1} fg={colors.text.muted}>preparing...</text>
    </box>
  );
});
