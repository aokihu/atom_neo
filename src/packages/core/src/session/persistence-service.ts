import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SessionMessage } from "@atom-neo/shared";
import type { ContextService, PersistedContextState } from "../context/context-service";
import { ToolRecordStore } from "../tools/tool-record-store";
import { CheckpointStore } from "./checkpoint-store";
import { HistoryStore } from "./history-store";
import { SessionContext } from "./context";
import type { CheckpointSession } from "./element-session";
import type {
  ArchiveReceipt,
  HistoryMatch,
  PersistedSessionState,
  SessionCheckpointReason,
} from "./types";
import {
  createMessageManifest,
  parseJsonl,
  parseToolRecordsJsonl,
  sessionsDirectory,
  toJsonl,
  toToolRecordsJsonl,
  type HistoryQuery,
  type HistoryRead,
} from "./session-format";

export class SessionPersistenceService {
  readonly toolRecords = new ToolRecordStore();
  readonly #checkpoints: CheckpointStore;
  readonly #history: HistoryStore;

  constructor(
    sandbox: string,
    private readonly contextService: ContextService,
  ) {
    this.#checkpoints = new CheckpointStore(sessionsDirectory(sandbox));
    this.#history = new HistoryStore(this.#checkpoints);
  }

  listTuiSessions(): { sessionId: string; lastTuiUsedAt: number }[] {
    const result: { sessionId: string; lastTuiUsedAt: number }[] = [];
    for (const sessionDir of this.#checkpoints.listSessionDirectories()) {
      const state = this.#checkpoints.readSessionState(
        this.#checkpoints.resolveCurrentGeneration(sessionDir) ?? sessionDir,
      );
      if (state?.initiator?.type === "tui") result.push({ sessionId: state.sessionId, lastTuiUsedAt: state.lastTuiUsedAt ?? 0 });
    }
    return result;
  }

  checkpoint(
    session: CheckpointSession,
    reason: SessionCheckpointReason,
    latestMessages: readonly SessionMessage[] = session.messages,
  ): PersistedSessionState {
    const dir = this.#checkpoints.getSessionDirectory(session.sessionId);
    const committedDir = this.#checkpoints.resolveCurrentGeneration(dir) ?? dir;
    const previous = this.#checkpoints.readSessionState(committedDir);
    const checkpointRevision = (previous?.checkpointRevision ?? 0) + 1;
    const archives = this.#history.inspectArchives(session.sessionId, latestMessages.length);
    const status = reason === "restore"
      ? "interrupted" as const
      : reason === "idle" || reason === "capacity" || reason === "shutdown"
        ? "suspended" as const
        : "active" as const;
    const state = session.exportState({ checkpointRevision, status, archives, reason });
    const context = this.contextService.exportSessionState(session.sessionId, checkpointRevision);
    const latest = createMessageManifest("message-latest", latestMessages, { checkpointRevision });
    const toolRecords = this.toolRecords.exportSession(session.sessionId);

    this.#checkpoints.commit(dir, checkpointRevision, {
      "message-latest.jsonl": toJsonl(latest, latestMessages),
      "context.json": JSON.stringify(context, null, 2) + "\n",
      "session.json": JSON.stringify(state, null, 2) + "\n",
      "tool-records.jsonl": toToolRecordsJsonl(checkpointRevision, toolRecords),
    });
    return state;
  }

  restore(sessionId: string): SessionContext | null {
    const { directory: checkpointDir, generation } = this.#checkpoints.resolveCheckpoint(sessionId);
    const state = this.#checkpoints.readSessionState(checkpointDir);
    if (!state) return null;
    if (state.sessionId !== sessionId) throw new Error("Session persistence ID mismatch");

    const latestPath = resolve(checkpointDir, "message-latest.jsonl");
    const latest = existsSync(latestPath)
      ? parseJsonl(readFileSync(latestPath, "utf8"))
      : { messages: [] };
    const contextPath = resolve(checkpointDir, "context.json");
    const toolRecordsPath = resolve(checkpointDir, "tool-records.jsonl");
    const toolRecords = existsSync(toolRecordsPath)
      ? parseToolRecordsJsonl(readFileSync(toolRecordsPath, "utf8"))
      : undefined;
    let context: PersistedContextState | undefined;
    if (existsSync(contextPath)) {
      context = JSON.parse(readFileSync(contextPath, "utf8")) as PersistedContextState;
      if (context.sessionId !== sessionId) throw new Error("Context persistence ID mismatch");
    }
    if (generation) {
      const latestRevision = latest.manifest?.checkpointRevision;
      if (latestRevision !== state.checkpointRevision
        || context?.checkpointRevision !== state.checkpointRevision
        || (toolRecords && toolRecords.checkpointRevision !== state.checkpointRevision)) {
        throw new Error(`Session checkpoint revision mismatch: ${state.checkpointRevision}`);
      }
    }
    if (toolRecords) this.toolRecords.restoreSession(sessionId, toolRecords.groups);
    else this.toolRecords.removeSession(sessionId);
    if (context) {
      this.contextService.restoreSessionState(context);
    }
    const session = SessionContext.restore(state, latest.messages);
    if (state.status === "active") this.checkpoint(session, "restore");
    return session;
  }

  archiveMessages(sessionId: string, messages: readonly SessionMessage[]): ArchiveReceipt | null {
    return this.#history.archiveMessages(sessionId, messages);
  }

  getArchiveIndex(sessionId: string): Readonly<Record<string, unknown>> {
    return this.#history.getArchiveIndex(sessionId);
  }

  searchHistory(sessionId: string, input: HistoryQuery): HistoryMatch[] {
    return this.#history.searchHistory(sessionId, input);
  }

  readHistory(sessionId: string, input: HistoryRead): HistoryMatch[] {
    return this.#history.readHistory(sessionId, input);
  }

  getHistoryArchiveRevision(sessionId: string, archiveId: string): number | undefined {
    return this.#history.getHistoryArchiveRevision(sessionId, archiveId);
  }

  remove(sessionId: string): void {
    this.toolRecords.removeSession(sessionId);
    this.#checkpoints.removeSession(sessionId);
  }

  getSessionDirectory(sessionId: string, create = true): string {
    return this.#checkpoints.getSessionDirectory(sessionId, create);
  }
}
