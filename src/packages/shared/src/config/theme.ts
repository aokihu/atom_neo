/** Single source for TUI theme identifiers; palettes live in the UI packages. */
export const THEME_NAMES = [
  "edex",
  "github-dark",
  "github-light",
  "dracula",
  "nord",
  "tokyo-night",
  "solarized-dark",
  "monokai",
] as const;

export type ThemeName = typeof THEME_NAMES[number];

export const DEFAULT_THEME: ThemeName = "edex";

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEME_NAMES as readonly string[]).includes(value);
}
