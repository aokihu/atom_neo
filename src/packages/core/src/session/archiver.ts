import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

export function archiveMessages(
  sandbox: string,
  sessionId: string,
  messages: Array<{ role: string; content: string; timestamp?: number }>,
): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dir = resolve(sandbox, ".atom", "session-history");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const prefix = resolve(dir, `${sessionId}-${date}`);
  let counter = 1;
  while (existsSync(`${prefix}-${counter}.jsonl`)) counter++;
  const path = `${prefix}-${counter}.jsonl`;

  const lines = messages.map(m => JSON.stringify({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp ?? Date.now(),
  })).join("\n") + "\n";

  appendFileSync(path, lines);
  return path;
}
