import { useTheme } from "./App";

export function PanelTitle({
  title,
  meta,
  tone = "secondary",
}: {
  title: string;
  meta?: string;
  tone?: "primary" | "secondary";
}) {
  const { colors } = useTheme();
  const primary = tone === "primary";

  return (
    <box
      height={2}
      flexShrink={0}
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={primary ? colors.accent.brand : colors.text.muted}>{title}</text>
      {meta && <text fg={colors.text.muted}>{meta}</text>}
    </box>
  );
}
