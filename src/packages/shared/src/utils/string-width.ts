import stringWidthLib from "string-width";

/** Terminal display width, ignoring ANSI escape sequences. */
export function stringWidth(text: string): number {
  return stringWidthLib(text);
}
