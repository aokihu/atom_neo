import { useTheme } from "./App";

/** Keep empty widgets quieter than their labels in both light and dark themes. */
export function EmptyState() {
  const { colors } = useTheme();
  const fg = "#" + [1, 3, 5].map(offset => {
    const text = parseInt(colors.text.muted.slice(offset, offset + 2), 16);
    const background = parseInt(colors.bg.page.slice(offset, offset + 2), 16);
    return Math.round(text * 0.6 + background * 0.4).toString(16).padStart(2, "0");
  }).join("");
  return <text fg={fg}>EMPTY</text>;
}
