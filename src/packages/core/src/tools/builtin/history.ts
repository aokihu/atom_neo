import { z } from "zod";
import { PermissionLevel, sanitizeForJSON, substringWellFormed } from "@atom-neo/shared";
import type { ToolDefinition } from "@atom-neo/shared";
import type { SessionPersistenceService } from "../../session/persistence-service";

const searchSchema = z.object({
  query: z.string().min(1),
  role: z.enum(["user", "assistant"]).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const readSchema = z.object({
  archiveId: z.string().regex(/^message-(?:\d{6}|latest)$/),
  fromSeq: z.number().int().min(0).optional(),
  toSeq: z.number().int().min(0).optional(),
  offset: z.number().int().min(0).optional(),
  checkpointRevision: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})
  .refine(input => input.fromSeq === undefined || input.toSeq === undefined || input.fromSeq <= input.toSeq)
  .refine(input => input.offset === undefined || input.fromSeq !== undefined);

const preview = (content: string, maxLength = 240): string => {
  const safe = sanitizeForJSON(content);
  return safe.length <= maxLength ? safe : `${substringWellFormed(safe, 0, maxLength - 3)}...`;
};

const READ_OUTPUT_LIMIT = 8_000;
const CURSOR_RESERVE = 400;

type HistoryCursor = {
  archiveId: string;
  fromSeq: number;
  toSeq: number;
  offset: number;
  limit: number;
  checkpointRevision?: number;
};

const createReadLine = (
  match: ReturnType<SessionPersistenceService["readHistory"]>[number],
  content: string,
): string => JSON.stringify({
  archiveId: match.archiveId,
  seq: match.seq,
  role: match.role,
  timestamp: match.timestamp,
  content,
});

const fitContent = (
  match: ReturnType<SessionPersistenceService["readHistory"]>[number],
  content: string,
  start: number,
  limit: number,
): { line: string; end: number } | null => {
  let low = start + 1;
  let high = content.length;
  let result: { line: string; end: number } | null = null;
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    const end = candidate < content.length
      && candidate > start
      && content.charCodeAt(candidate - 1) >= 0xD800
      && content.charCodeAt(candidate - 1) <= 0xDBFF
      && content.charCodeAt(candidate) >= 0xDC00
      && content.charCodeAt(candidate) <= 0xDFFF
      ? candidate - 1
      : candidate;
    const chunk = substringWellFormed(content, start, end);
    const line = createReadLine(match, chunk);
    if (line.length <= limit) {
      if (end > start) result = { line, end };
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }
  return result;
};

export const createHistoryTools = (persistence: SessionPersistenceService): ToolDefinition[] => [
  {
    name: "search_history",
    description: "Search archived messages from the current session. Returns exact archive and sequence references; use read_history for full text.",
    source: "builtin",
    inputSchema: searchSchema,
    permission: PermissionLevel.READ_ONLY,
    execute: async (args, options) => {
      const parsed = searchSchema.safeParse(args);
      if (!parsed.success) return { ok: false, output: "", error: "Invalid input" };
      if (!options?.sessionId) return { ok: false, output: "", error: "Session unavailable" };
      try {
        const revisionBefore = persistence.getHistoryArchiveRevision(options.sessionId, "message-latest");
        const matches = persistence.searchHistory(options.sessionId, parsed.data);
        const revisionAfter = persistence.getHistoryArchiveRevision(options.sessionId, "message-latest");
        if (matches.some(match => match.archiveId === "message-latest") && revisionBefore !== revisionAfter) {
          throw new Error("Session history changed; retry search");
        }
        const output = matches.map(match => {
          const revision = match.archiveId === "message-latest" && revisionAfter !== undefined
            ? ` checkpointRevision="${revisionAfter}"`
            : "";
          return `<HistoryMatch archiveId="${match.archiveId}" seq="${match.seq}" role="${match.role}" timestamp="${match.timestamp}"${revision}>\n${preview(match.content)}\n</HistoryMatch>`;
        }).join("\n");
        return { ok: true, output: output || "No matching session history.", data: { count: matches.length } };
      } catch (error) {
        return { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
      }
    },
  },
  {
    name: "read_history",
    description: "Read an exact bounded range from a current-session history archive returned by search_history.",
    source: "builtin",
    inputSchema: readSchema,
    permission: PermissionLevel.READ_ONLY,
    execute: async (args, options) => {
      const parsed = readSchema.safeParse(args);
      if (!parsed.success) return { ok: false, output: "", error: "Invalid input" };
      if (!options?.sessionId) return { ok: false, output: "", error: "Session unavailable" };
      try {
        const limit = parsed.data.limit ?? 20;
        const toSeq = parsed.data.toSeq ?? Number.MAX_SAFE_INTEGER;
        const archiveRevision = persistence.getHistoryArchiveRevision(options.sessionId, parsed.data.archiveId);
        if (parsed.data.archiveId === "message-latest"
          && parsed.data.checkpointRevision !== undefined
          && parsed.data.checkpointRevision !== archiveRevision) {
          throw new Error("History cursor expired");
        }
        const candidates = persistence.readHistory(options.sessionId, { ...parsed.data, limit: limit + 1 });
        if (parsed.data.archiveId === "message-latest"
          && persistence.getHistoryArchiveRevision(options.sessionId, parsed.data.archiveId) !== archiveRevision) {
          throw new Error("History cursor expired");
        }
        if (parsed.data.fromSeq !== undefined) {
          const anchor = candidates[0];
          if (!anchor || anchor.seq !== parsed.data.fromSeq) {
            throw new Error("History cursor expired");
          }
        }
        if (parsed.data.offset !== undefined) {
          const anchor = candidates[0]!;
          const content = sanitizeForJSON(anchor.content);
          const offset = parsed.data.offset;
          if (offset > content.length || (content.length > 0 && offset === content.length)) {
            throw new Error("Invalid history offset");
          }
          const previous = content.charCodeAt(offset - 1);
          const next = content.charCodeAt(offset);
          if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
            throw new Error("Invalid history offset");
          }
        }
        const hasMore = candidates.length > limit;
        const matches = candidates.slice(0, limit);
        const lines: string[] = [];
        let length = 0;
        let cursor: HistoryCursor | undefined;
        const createCursor = (match: typeof candidates[number], offset: number): HistoryCursor => ({
          archiveId: match.archiveId,
          fromSeq: match.seq,
          toSeq,
          offset,
          limit,
          ...(archiveRevision === undefined ? {} : { checkpointRevision: archiveRevision }),
        });
        for (const [index, match] of matches.entries()) {
          const content = sanitizeForJSON(match.content);
          const start = index === 0 ? Math.min(parsed.data.offset ?? 0, content.length) : 0;
          const available = READ_OUTPUT_LIMIT - CURSOR_RESERVE - length - (lines.length > 0 ? 1 : 0);
          const fullLine = createReadLine(match, substringWellFormed(content, start));
          if (fullLine.length <= available) {
            lines.push(fullLine);
            length += fullLine.length + (lines.length > 1 ? 1 : 0);
            continue;
          }

          const fitted = fitContent(match, content, start, available);
          if (fitted) {
            lines.push(fitted.line);
            cursor = createCursor(match, fitted.end);
          } else {
            cursor = createCursor(match, start);
          }
          break;
        }
        if (!cursor && (lines.length < matches.length || hasMore)) {
          const next = candidates[lines.length]!;
          cursor = createCursor(next, 0);
        }
        if (cursor) lines.push(JSON.stringify({ type: "history_cursor", next: cursor }));
        return {
          ok: true,
          output: lines.join("\n") || "No messages in the requested range.",
          data: { count: lines.length - (cursor ? 1 : 0), cursor },
        };
      } catch (error) {
        return { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
      }
    },
  },
];
