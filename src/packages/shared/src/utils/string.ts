export const substringWellFormed = (text: string, start: number, end?: number): string =>
  text.substring(start, end).toWellFormed();

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str.toWellFormed();
  return substringWellFormed(str, 0, Math.max(0, maxLen - 3)) + "...";
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
