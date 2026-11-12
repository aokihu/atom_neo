import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { SessionMessage, ToolsGroup } from "@atom-neo/shared";
import type { ArchiveReceipt } from "./types";

export type MessageManifest = {
  type: "manifest";
  schemaVersion: 1;
  archiveId: string;
  checkpointRevision?: number;
  segment?: number;
  fromSeq: number;
  toSeq: number;
  count: number;
  createdAt: number;
};

export type HistoryQuery = {
  query: string;
  role?: "user" | "assistant";
  limit?: number;
};

export type HistoryRead = {
  archiveId: string;
  fromSeq?: number;
  toSeq?: number;
  limit?: number;
};

export const SEGMENT_PATTERN = /^message-(\d{6})\.jsonl$/;
export const ARCHIVE_ID_PATTERN = /^message-(?:\d{6}|latest)$/;
export const GENERATION_PATTERN = /^g-(\d{12})-[0-9a-f-]{36}$/;
export const CHECKPOINT_FILES = ["session.json", "context.json", "message-latest.jsonl", "tool-records.jsonl"] as const;
export type CheckpointFilename = (typeof CHECKPOINT_FILES)[number];

export const sessionsDirectory = (sandbox: string): string => resolve(sandbox, ".atom", "sessions");

export const sessionDirectoryPath = (sessionsDir: string, sessionId: string): string =>
  resolve(sessionsDir, toSafeSessionId(sessionId));

export const toSafeSessionId = (sessionId: string): string =>
  createHash("sha256").update(sessionId).digest("hex").substring(0, 32);

export const toJsonl = (manifest: MessageManifest, messages: readonly SessionMessage[]): string => [
  JSON.stringify(manifest),
  ...messages.map(message => JSON.stringify({ type: "message", ...message })),
].join("\n") + "\n";

export const parseJsonl = (content: string): { manifest?: MessageManifest; messages: SessionMessage[] } => {
  let manifest: MessageManifest | undefined;
  const messages: SessionMessage[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value.type === "manifest") {
      manifest = value as MessageManifest;
      continue;
    }
    if (value.type !== "message") continue;
    const { type: _type, ...message } = value;
    messages.push(message as SessionMessage);
  }
  return { manifest, messages };
};

export const toToolRecordsJsonl = (checkpointRevision: number, groups: readonly ToolsGroup[]): string => [
  JSON.stringify({ type: "manifest", schemaVersion: 1, checkpointRevision, count: groups.length }),
  ...groups.map(group => JSON.stringify({ type: "tools-group", group })),
].join("\n") + "\n";

export const parseToolRecordsJsonl = (content: string): { checkpointRevision?: number; groups: ToolsGroup[] } => {
  let checkpointRevision: number | undefined;
  const groups: ToolsGroup[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value.type === "manifest") checkpointRevision = Number(value.checkpointRevision);
    if (value.type === "tools-group" && value.group) groups.push(value.group as ToolsGroup);
  }
  return { checkpointRevision, groups };
};

export const createMessageManifest = (
  archiveId: string,
  messages: readonly SessionMessage[],
  extra: Pick<MessageManifest, "checkpointRevision" | "segment">,
): MessageManifest => ({
  type: "manifest",
  schemaVersion: 1,
  archiveId,
  ...extra,
  fromSeq: messages[0]?.seq ?? 0,
  toSeq: messages.at(-1)?.seq ?? 0,
  count: messages.length,
  createdAt: Date.now(),
});

export const toReceipt = (manifest: MessageManifest): ArchiveReceipt => ({
  archiveId: manifest.archiveId,
  segment: manifest.segment ?? 0,
  fromSeq: manifest.fromSeq,
  toSeq: manifest.toSeq,
  count: manifest.count,
});
