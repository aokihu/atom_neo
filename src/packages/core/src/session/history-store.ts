import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { SessionMessage } from "@atom-neo/shared";
import type { ArchiveReceipt, HistoryMatch, SessionArchiveState } from "./types";
import type { CheckpointStore } from "./checkpoint-store";
import {
  ARCHIVE_ID_PATTERN,
  SEGMENT_PATTERN,
  createMessageManifest,
  parseJsonl,
  toJsonl,
  toReceipt,
  type HistoryQuery,
  type HistoryRead,
} from "./session-format";
import { writeAtomic } from "./durable-fs";

type HistoryStoreDeps = Pick<CheckpointStore, "getSessionDirectory" | "resolveCurrentGeneration">;

export class HistoryStore {
  constructor(private readonly checkpoints: HistoryStoreDeps) {}

  archiveMessages(sessionId: string, messages: readonly SessionMessage[]): ArchiveReceipt | null {
    if (messages.length === 0) return null;
    const seqs = messages.map(message => message.seq);
    if (seqs.some(seq => !Number.isInteger(seq))) throw new Error("Cannot archive messages without seq");
    const fromSeq = seqs[0]!;
    const toSeq = seqs.at(-1)!;
    const dir = this.checkpoints.getSessionDirectory(sessionId);

    for (const filename of this.#segmentFiles(dir)) {
      const parsed = parseJsonl(readFileSync(resolve(dir, filename), "utf8"));
      if (parsed.manifest?.fromSeq === fromSeq && parsed.manifest.toSeq === toSeq) {
        return toReceipt(parsed.manifest);
      }
    }

    const segment = this.#nextSegment(dir);
    const archiveId = `message-${String(segment).padStart(6, "0")}`;
    const manifest = createMessageManifest(archiveId, messages, { segment });
    const path = resolve(dir, `${archiveId}.jsonl`);
    writeAtomic(path, toJsonl(manifest, messages));

    const verified = parseJsonl(readFileSync(path, "utf8"));
    if (verified.messages.length !== messages.length) {
      rmSync(path, { force: true });
      throw new Error(`Archive verification failed: expected ${messages.length}, got ${verified.messages.length}`);
    }
    return toReceipt(manifest);
  }

  inspectArchives(sessionId: string, latestMessageCount: number): SessionArchiveState {
    const dir = this.checkpoints.getSessionDirectory(sessionId);
    const manifests = this.#manifests(dir);
    return {
      segmentCount: manifests.length,
      archivedMessageCount: manifests.reduce((total, item) => total + item.count, 0),
      latestMessageCount,
      nextSegment: this.#nextSegment(dir),
    };
  }

  getArchiveIndex(sessionId: string): Readonly<Record<string, unknown>> {
    const dir = this.checkpoints.getSessionDirectory(sessionId, false);
    const manifests = existsSync(dir) ? this.#manifests(dir) : [];
    return {
      segmentCount: manifests.length,
      messageCount: manifests.reduce((total, item) => total + item.count, 0),
      fromSeq: manifests[0]?.fromSeq,
      toSeq: manifests.at(-1)?.toSeq,
      latestArchiveId: manifests.at(-1)?.archiveId,
      retrieval: "Use search_history, then read_history, to verify original conversation messages.",
    };
  }

  searchHistory(sessionId: string, input: HistoryQuery): HistoryMatch[] {
    const query = input.query.trim().toLocaleLowerCase();
    if (!query) return [];
    const limit = Math.min(20, Math.max(1, input.limit ?? 5));
    const matches = new Map<number, HistoryMatch>();
    for (const archiveId of this.#archiveIds(sessionId, true)) {
      for (const message of this.#readArchive(sessionId, archiveId)) {
        if (message.visible === false || (message.role !== "user" && message.role !== "assistant")) continue;
        if (input.role && message.role !== input.role) continue;
        if (!message.content.toLocaleLowerCase().includes(query) || message.seq === undefined) continue;
        if (matches.has(message.seq)) continue;
        matches.set(message.seq, {
          archiveId,
          seq: message.seq,
          role: message.role,
          timestamp: message.timestamp,
          content: message.content,
        });
      }
    }
    return [...matches.values()].toSorted((a, b) => a.seq - b.seq).slice(0, limit);
  }

  readHistory(sessionId: string, input: HistoryRead): HistoryMatch[] {
    if (!ARCHIVE_ID_PATTERN.test(input.archiveId)) throw new Error("Invalid archiveId");
    const limit = Math.min(51, Math.max(1, input.limit ?? 20));
    const fromSeq = input.fromSeq ?? 0;
    const toSeq = input.toSeq ?? Number.MAX_SAFE_INTEGER;
    if (fromSeq > toSeq) throw new Error("Invalid history range");
    return this.#readArchive(sessionId, input.archiveId)
      .filter(message => message.visible !== false
        && (message.role === "user" || message.role === "assistant")
        && message.seq !== undefined
        && message.seq >= fromSeq
        && message.seq <= toSeq)
      .slice(0, limit)
      .map(message => ({
        archiveId: input.archiveId,
        seq: message.seq!,
        role: message.role,
        timestamp: message.timestamp,
        content: message.content,
      }));
  }

  getHistoryArchiveRevision(sessionId: string, archiveId: string): number | undefined {
    if (!ARCHIVE_ID_PATTERN.test(archiveId)) throw new Error("Invalid archiveId");
    const path = this.#getArchivePath(sessionId, archiveId);
    if (!existsSync(path)) return undefined;
    return parseJsonl(readFileSync(path, "utf8")).manifest?.checkpointRevision;
  }

  #manifests(dir: string) {
    return this.#segmentFiles(dir).flatMap(filename => {
      const value = parseJsonl(readFileSync(resolve(dir, filename), "utf8")).manifest;
      return value ? [value] : [];
    });
  }

  #archiveIds(sessionId: string, includeLatest: boolean): string[] {
    const dir = this.checkpoints.getSessionDirectory(sessionId, false);
    if (!existsSync(dir)) return [];
    const ids = this.#segmentFiles(dir).map(filename => filename.replace(/\.jsonl$/, ""));
    if (includeLatest && existsSync(this.#getArchivePath(sessionId, "message-latest"))) ids.push("message-latest");
    return ids;
  }

  #readArchive(sessionId: string, archiveId: string): SessionMessage[] {
    if (!ARCHIVE_ID_PATTERN.test(archiveId)) throw new Error("Invalid archiveId");
    const path = this.#getArchivePath(sessionId, archiveId);
    if (!existsSync(path)) return [];
    return parseJsonl(readFileSync(path, "utf8")).messages;
  }

  #getArchivePath(sessionId: string, archiveId: string): string {
    const dir = this.checkpoints.getSessionDirectory(sessionId, false);
    if (archiveId !== "message-latest") return resolve(dir, `${archiveId}.jsonl`);
    return resolve(this.checkpoints.resolveCurrentGeneration(dir) ?? dir, "message-latest.jsonl");
  }

  #nextSegment(dir: string): number {
    const last = this.#segmentFiles(dir).at(-1)?.match(SEGMENT_PATTERN)?.[1];
    return Number(last ?? 0) + 1;
  }

  #segmentFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(filename => SEGMENT_PATTERN.test(filename)).toSorted();
  }
}
