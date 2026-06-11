export function sanitizeForJSON(text: string): string {
  const wellFormed: string = typeof text.toWellFormed === "function"
    ? text.toWellFormed()
    : new TextDecoder().decode(new TextEncoder().encode(text));

  return wellFormed.replace(/\\u[0-9a-fA-F]{0,4}/g, (match) => {
    const hex = match.slice(2);
    if (hex.length === 4) {
      const cp = parseInt(hex, 16);
      if (cp >= 0xD800 && cp <= 0xDFFF) return "";
      return String.fromCharCode(cp);
    }
    return "";
  });
}
