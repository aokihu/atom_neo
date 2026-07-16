import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { SessionMessage } from "@atom-neo/shared";
import type { ContextService, PersistedContextState } from "../context/context-service";
import { SessionContext } from "./context";
import type {
  ArchiveReceipt,
  HistoryMatch,
  PersistedSessionState,
  SessionArchiveState,
  SessionCheckpointReason,
} from "./types";

type MessageManifest = {
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

type HistoryQuery = {
  query: string;
  role?: "user" | "assistant";
  limit?: number;
};

type HistoryRead = {
  archiveId: string;
  fromSeq?: number;
  toSeq?: number;
  limit?: number;
};

const SEGMENT_PATTERN = /^message-(\d{6})\.jsonl$/;
const ARCHIVE_ID_PATTERN = /^message-(?:\d{6}|latest)$/;
const GENERATION_PATTERN = /^g-(\d{12})-[0-9a-f-]{36}$/;
const CHECKPOINT_FILES = ["session.json", "context.json", "message-latest.jsonl"] as const;

const toSafeSessionId = (sessionId: string): string =>
  createHash("sha256").update(sessionId).digest("hex").substring(0, 32);

const toJsonl = (manifest: MessageManifest, messages: readonly SessionMessage[]): string => [
  JSON.stringify(manifest),
  ...messages.map(message => JSON.stringify({ type: "message", ...message })),
].join("\n") + "\n";

const parseJsonl = (content: string): { manifest?: MessageManifest; messages: SessionMessage[] } => {
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

export class SessionPersistenceService {
  #sessionsDir: string;

  constructor(
    sandbox: string,
    private readonly contextService: ContextService,
  ) {
    this.#sessionsDir = resolve(sandbox, ".atom", "sessions");
    mkdirSync(this.#sessionsDir, { recursive: true, mode: 0o700 });
  }

  checkpoint(
    session: SessionContext,
    reason: SessionCheckpointReason,
    latestMessages: readonly SessionMessage[] = session.messages,
  ): PersistedSessionState {
    const dir = this.getSessionDirectory(session.sessionId);
    const committedDir = this.#resolveCurrentGeneration(dir) ?? dir;
    const previous = this.#readSessionState(committedDir);
    const checkpointRevision = (previous?.checkpointRevision ?? 0) + 1;
    const archives = this.#inspectArchives(dir, latestMessages.length);
    const status = reason === "restore"
      ? "interrupted" as const
      : reason === "idle" || reason === "capacity" || reason === "shutdown"
        ? "suspended" as const
        : "active" as const;
    const state = session.exportState({ checkpointRevision, status, archives, reason });
    const context = this.contextService.exportSessionState(session.sessionId, checkpointRevision);
    const latest = this.#createManifest("message-latest", latestMessages, { checkpointRevision });

    const generation = this.#writeGeneration(dir, checkpointRevision, {
      "message-latest.jsonl": toJsonl(latest, latestMessages),
      "context.json": JSON.stringify(context, null, 2) + "\n",
      "session.json": JSON.stringify(state, null, 2) + "\n",
    });
    this.#publishGeneration(dir, generation);
    this.#cleanupGenerations(dir, generation);
    return state;
  }

  restore(sessionId: string): SessionContext | null {
    const dir = this.getSessionDirectory(sessionId, false);
    const generation = this.#resolveCurrentGeneration(dir);
    const checkpointDir = generation ?? dir;
    const state = this.#readSessionState(checkpointDir);
    if (!state) return null;
    if (state.sessionId !== sessionId) throw new Error("Session persistence ID mismatch");

    const latestPath = resolve(checkpointDir, "message-latest.jsonl");
    const latest = existsSync(latestPath)
      ? parseJsonl(readFileSync(latestPath, "utf8"))
      : { messages: [] };
    const contextPath = resolve(checkpointDir, "context.json");
    let context: PersistedContextState | undefined;
    if (existsSync(contextPath)) {
      context = JSON.parse(readFileSync(contextPath, "utf8")) as PersistedContextState;
      if (context.sessionId !== sessionId) throw new Error("Context persistence ID mismatch");
    }
    if (generation) {
      const latestRevision = latest.manifest?.checkpointRevision;
      if (latestRevision !== state.checkpointRevision
        || context?.checkpointRevision !== state.checkpointRevision) {
        throw new Error(`Session checkpoint revision mismatch: ${state.checkpointRevision}`);
      }
    }
    if (context) {
      this.contextService.restoreSessionState(context);
    }
    const session = SessionContext.restore(state, latest.messages);
    if (state.status === "active") this.checkpoint(session, "restore");
    return session;
  }

  archiveMessages(sessionId: string, messages: readonly SessionMessage[]): ArchiveReceipt | null {
    if (messages.length === 0) return null;
    const seqs = messages.map(message => message.seq);
    if (seqs.some(seq => !Number.isInteger(seq))) throw new Error("Cannot archive messages without seq");
    const fromSeq = seqs[0]!;
    const toSeq = seqs.at(-1)!;
    const dir = this.getSessionDirectory(sessionId);

    for (const filename of this.#segmentFiles(dir)) {
      const parsed = parseJsonl(readFileSync(resolve(dir, filename), "utf8"));
      if (parsed.manifest?.fromSeq === fromSeq && parsed.manifest.toSeq === toSeq) {
        return this.#toReceipt(parsed.manifest);
      }
    }

    const segment = this.#nextSegment(dir);
    const archiveId = `message-${String(segment).padStart(6, "0")}`;
    const manifest = this.#createManifest(archiveId, messages, { segment });
    const path = resolve(dir, `${archiveId}.jsonl`);
    this.#writeAtomic(path, toJsonl(manifest, messages));

    const verified = parseJsonl(readFileSync(path, "utf8"));
    if (verified.messages.length !== messages.length) {
      rmSync(path, { force: true });
      throw new Error(`Archive verification failed: expected ${messages.length}, got ${verified.messages.length}`);
    }
    return this.#toReceipt(manifest);
  }

  getArchiveIndex(sessionId: string): Readonly<Record<string, unknown>> {
    const dir = this.getSessionDirectory(sessionId, false);
    const segments = existsSync(dir) ? this.#segmentFiles(dir) : [];
    const manifests = segments.flatMap(filename => {
      const value = parseJsonl(readFileSync(resolve(dir, filename), "utf8")).manifest;
      return value ? [value] : [];
    });
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

  remove(sessionId: string): void {
    rmSync(this.getSessionDirectory(sessionId, false), { recursive: true, force: true });
  }

  getSessionDirectory(sessionId: string, create = true): string {
    const dir = resolve(this.#sessionsDir, toSafeSessionId(sessionId));
    if (create) mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  #archiveIds(sessionId: string, includeLatest: boolean): string[] {
    const dir = this.getSessionDirectory(sessionId, false);
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
    const dir = this.getSessionDirectory(sessionId, false);
    if (archiveId !== "message-latest") return resolve(dir, `${archiveId}.jsonl`);
    return resolve(this.#resolveCurrentGeneration(dir) ?? dir, "message-latest.jsonl");
  }

  #inspectArchives(dir: string, latestMessageCount: number): SessionArchiveState {
    const manifests = this.#segmentFiles(dir).flatMap(filename => {
      const value = parseJsonl(readFileSync(resolve(dir, filename), "utf8")).manifest;
      return value ? [value] : [];
    });
    return {
      segmentCount: manifests.length,
      archivedMessageCount: manifests.reduce((total, item) => total + item.count, 0),
      latestMessageCount,
      nextSegment: this.#nextSegment(dir),
    };
  }

  #createManifest(
    archiveId: string,
    messages: readonly SessionMessage[],
    extra: Pick<MessageManifest, "checkpointRevision" | "segment">,
  ): MessageManifest {
    return {
      type: "manifest",
      schemaVersion: 1,
      archiveId,
      ...extra,
      fromSeq: messages[0]?.seq ?? 0,
      toSeq: messages.at(-1)?.seq ?? 0,
      count: messages.length,
      createdAt: Date.now(),
    };
  }

  #nextSegment(dir: string): number {
    const last = this.#segmentFiles(dir).at(-1)?.match(SEGMENT_PATTERN)?.[1];
    return Number(last ?? 0) + 1;
  }

  #segmentFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(filename => SEGMENT_PATTERN.test(filename)).toSorted();
  }

  #readSessionState(dir: string): PersistedSessionState | null {
    const path = resolve(dir, "session.json");
    if (!existsSync(path)) return null;
    const state = JSON.parse(readFileSync(path, "utf8")) as PersistedSessionState;
    if (state.schemaVersion !== 1) throw new Error(`Unsupported session schema: ${state.schemaVersion}`);
    return state;
  }

  #writeGeneration(
    sessionDir: string,
    revision: number,
    files: Record<(typeof CHECKPOINT_FILES)[number], string>,
  ): string {
    const checkpointsDir = resolve(sessionDir, ".checkpoints");
    mkdirSync(checkpointsDir, { recursive: true, mode: 0o700 });
    const generation = `g-${String(revision).padStart(12, "0")}-${randomUUID()}`;
    const temporary = resolve(checkpointsDir, `.${generation}.tmp`);
    const target = resolve(checkpointsDir, generation);
    mkdirSync(temporary, { mode: 0o700 });
    try {
      for (const filename of CHECKPOINT_FILES) {
        this.#writeDurable(resolve(temporary, filename), files[filename]);
      }
      this.#fsyncDirectory(temporary);
      renameSync(temporary, target);
      this.#fsyncDirectory(checkpointsDir);
      return generation;
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  #publishGeneration(sessionDir: string, generation: string): void {
    const temporary = resolve(sessionDir, `.current-${randomUUID()}.tmp`);
    try {
      symlinkSync(`.checkpoints/${generation}`, temporary, "dir");
      renameSync(temporary, resolve(sessionDir, "current"));
      this.#fsyncDirectory(sessionDir);
    } finally {
      rmSync(temporary, { force: true });
    }

    try {
      for (const filename of CHECKPOINT_FILES) {
        const facade = resolve(sessionDir, filename);
        if (existsSync(facade) && lstatSync(facade).isSymbolicLink()
          && readlinkSync(facade) === `current/${filename}`) continue;
        const link = resolve(sessionDir, `.${filename}.${randomUUID()}.tmp`);
        try {
          symlinkSync(`current/${filename}`, link, "file");
          renameSync(link, facade);
        } finally {
          rmSync(link, { force: true });
        }
      }
      this.#fsyncDirectory(sessionDir);
    } catch {
      // `current` is already committed; the next checkpoint repairs compatibility links.
    }
  }

  #resolveCurrentGeneration(sessionDir: string): string | null {
    const current = resolve(sessionDir, "current");
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!stat.isSymbolicLink()) throw new Error("Invalid session checkpoint pointer");
    const target = resolve(sessionDir, readlinkSync(current));
    const checkpointsDir = resolve(sessionDir, ".checkpoints");
    if (dirname(target) !== checkpointsDir || !GENERATION_PATTERN.test(basename(target))) {
      throw new Error("Invalid session checkpoint pointer");
    }
    if (!existsSync(target) || !lstatSync(target).isDirectory()) {
      throw new Error("Session checkpoint generation is missing");
    }
    return target;
  }

  #cleanupGenerations(sessionDir: string, current: string): void {
    const checkpointsDir = resolve(sessionDir, ".checkpoints");
    try {
      const generations = readdirSync(checkpointsDir)
        .filter(name => GENERATION_PATTERN.test(name))
        .toSorted()
        .reverse();
      const keep = new Set([current, generations.find(name => name !== current)].filter(Boolean));
      for (const name of readdirSync(checkpointsDir)) {
        if (keep.has(name)) continue;
        if (GENERATION_PATTERN.test(name) || /^\.g-.*\.tmp$/.test(name)) {
          rmSync(resolve(checkpointsDir, name), { recursive: true, force: true });
        }
      }
      this.#fsyncDirectory(checkpointsDir);
    } catch {
      // A committed checkpoint remains valid even if old-generation cleanup fails.
    }
  }

  #writeDurable(path: string, content: string): void {
    writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
    const handle = openSync(path, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  }

  #fsyncDirectory(path: string): void {
    const handle = openSync(path, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  }

  #writeAtomic(path: string, content: string): void {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
      const handle = openSync(temporary, "r");
      try {
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
      renameSync(temporary, path);
      this.#fsyncDirectory(dirname(path));
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  #toReceipt(manifest: MessageManifest): ArchiveReceipt {
    return {
      archiveId: manifest.archiveId,
      segment: manifest.segment ?? 0,
      fromSeq: manifest.fromSeq,
      toSeq: manifest.toSeq,
      count: manifest.count,
    };
  }
}
