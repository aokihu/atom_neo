export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Parse a TCP port. Returns undefined for blanks, non-digits, and out-of-range values. */
export function parsePortValue(value: string, options: { allowZero?: boolean } = {}): number | undefined {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;
  const port = Number(trimmed);
  const min = options.allowZero ? 0 : 1;
  return Number.isInteger(port) && port >= min && port <= 65535 ? port : undefined;
}
