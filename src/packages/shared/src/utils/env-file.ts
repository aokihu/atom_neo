const KEY_VALUE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

export type EnvEntry = { key: string; value: string };

function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    let out = "";
    for (let i = 1; i < raw.length - 1; i++) {
      const char = raw[i];
      if (char !== "\\") {
        out += char;
        continue;
      }
      const next = raw[++i];
      if (next === undefined) {
        out += "\\";
        break;
      }
      out += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
    }
    return out;
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  return raw;
}

function quote(value: string): string {
  if (value === "") return "";
  if (/^[A-Za-z0-9_./:@%+,=-]+$/.test(value)) return value;
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

function entryOf(line: string): EnvEntry | undefined {
  const match = KEY_VALUE.exec(line);
  if (!match) return undefined;
  return { key: match[1]!, value: unquote(match[2]!.trim()) };
}

/** Parse KEY=VALUE / export KEY=VALUE lines. Duplicate keys: last one wins. */
export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of parseEnvEntries(content)) result[entry.key] = entry.value;
  return result;
}

export function parseEnvEntries(content: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const entry = entryOf(line);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Unique keys in file order, including `export KEY=` and duplicates once. */
export function parseEnvKeys(content: string): string[] {
  const keys: string[] = [];
  for (const entry of parseEnvEntries(content)) if (!keys.includes(entry.key)) keys.push(entry.key);
  return keys;
}

export function serializeEnv(entries: Record<string, string>, eol = "\n"): string {
  const lines = Object.entries(entries).map(([key, value]) => `${key}=${quote(value)}`);
  return lines.length > 0 ? lines.join(eol) + eol : "";
}

/**
 * Update existing keys in place (matching `KEY=` and `export KEY=`) and append new
 * ones. Comments, blank lines, ordering, and the file's EOL style are preserved.
 */
export function upsertEnv(content: string, updates: Record<string, string>, options: { eol?: string } = {}): string {
  const keys = Object.keys(updates);
  if (keys.length === 0) return content;
  const eol = options.eol ?? (content.includes("\r\n") ? "\r\n" : "\n");
  const lines = content === "" ? [] : content.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index++) {
    const entry = entryOf(lines[index]!);
    if (!entry || !Object.hasOwn(updates, entry.key)) continue;
    const exported = /^\s*export\s+/.test(lines[index]!);
    lines[index] = `${exported ? "export " : ""}${entry.key}=${quote(updates[entry.key]!)}`;
    seen.add(entry.key);
  }
  for (const key of keys) {
    if (!seen.has(key)) lines.push(`${key}=${quote(updates[key]!)}`);
  }
  return lines.join(eol) + eol;
}

/** Line-preserving merge: incoming values win per key, local comments/order stay. */
export function mergeEnv(local: string, incoming: string): string {
  const eol = local.includes("\r\n") || (local === "" && incoming.includes("\r\n")) ? "\r\n" : "\n";
  const incomingLines = new Map<string, string>();
  for (const line of incoming.split(/\r?\n/)) {
    const entry = entryOf(line);
    if (entry) incomingLines.set(entry.key, line);
  }
  const lines = local.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const line of lines) {
    const entry = entryOf(line);
    if (entry && incomingLines.has(entry.key)) {
      if (!seen.has(entry.key)) {
        merged.push(incomingLines.get(entry.key)!);
        seen.add(entry.key);
      }
      continue;
    }
    merged.push(line);
  }
  for (const [key, line] of incomingLines) if (!seen.has(key)) merged.push(line);
  return merged.length > 0 ? merged.join(eol) + eol : "";
}
