import type { ContextEntry, SessionMessage } from "@atom-neo/shared";
import type { ContextService } from "@core/context/context-service";
import { estimateTokenCount } from "@core/context/compiler";
import type { CheckpointSession, PipelineMessage } from "@core/session/element-session";
import type { SessionPersistenceService } from "@core/session/persistence-service";
import type { ArchiveReceipt } from "@core/session/types";

export type TokenEstimate = { snapshot: number; messages: number; total: number };

export type CompressCommitParams = {
  session: CheckpointSession;
  sessionId: string;
  summary?: string;
  archiveMessages: readonly SessionMessage[];
  archiveReceipt?: ArchiveReceipt;
  contextService: ContextService;
  persistence: Pick<SessionPersistenceService, "getArchiveIndex" | "checkpoint">;
  workspaceId: string;
  inputBudget: number;
};

export type CompressCommitResult =
  | { ok: true; removed: number; previousContextTokens: number; remainingMessages: PipelineMessage[]; tokenEstimate: TokenEstimate }
  | { ok: false; error: string };

function restoreEntry(contextService: ContextService, sessionId: string, key: string, previous?: Readonly<ContextEntry>): void {
  if (!previous) {
    contextService.remove("session", { sessionId }, key);
    return;
  }
  const { revision: _revision, ...entry } = previous;
  contextService.put({ scope: "session", owner: { sessionId }, entry });
}

function estimateContextTokens(contextService: ContextService, workspaceId: string, inputBudget: number,
  session: CheckpointSession, messages: readonly PipelineMessage[]): TokenEstimate {
  const snapshot = contextService.createSnapshot({
    workspaceId,
    sessionId: session.sessionId ?? "default",
    ...(session.currentTopic ? { topicId: session.currentTopic } : {}),
    inputBudget,
  });
  const snapshotTokens = contextService.inspectSnapshot(snapshot.id)?.estimatedTokens ?? 0;
  contextService.releaseSnapshot(snapshot.id);
  const visibleMessages = messages
    .filter(message => message.visible !== false)
    .map(message => ({
      role: message.role,
      content: message.content,
      ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {}),
    }));
  const messageTokens = visibleMessages.length > 0 ? estimateTokenCount(visibleMessages) : 0;
  return { snapshot: snapshotTokens, messages: messageTokens, total: snapshotTokens + messageTokens };
}

/** Write summary/index entries, checkpoint, then remove archived messages. Rolls back on checkpoint failure. */
export function commitCompression(params: CompressCommitParams): CompressCommitResult {
  const { session, sessionId, contextService, persistence, archiveMessages, archiveReceipt } = params;
  const previousSummary = contextService.get("session", { sessionId }, "conversation-summary");
  const previousIndex = contextService.get("session", { sessionId }, "history-archive-index");

  if (params.summary) {
    const label = "[对话历史摘要]";
    contextService.put({
      scope: "session",
      owner: { sessionId },
      entry: {
        key: "conversation-summary",
        source: "context-compress",
        channel: "messages",
        trust: "untrusted",
        priority: 700,
        content: [{ role: "assistant", content: `${label}\n${params.summary}` }],
      },
    });
  }
  if (archiveReceipt) {
    contextService.put({
      scope: "session",
      owner: { sessionId },
      entry: {
        key: "history-archive-index",
        source: "session-history",
        channel: "runtime",
        trust: "trusted",
        priority: 500,
        content: persistence.getArchiveIndex(sessionId),
      },
    });
  }

  const archivedSeqs = archiveMessages.flatMap(message => message.seq === undefined ? [] : [message.seq]);
  const archived = new Set(archivedSeqs);
  const remainingMessages = (session.messages ?? []).filter((message: { seq?: number }) =>
    message.seq === undefined || !archived.has(message.seq));
  const previousContextTokens = session.contextTokens ?? 0;
  const tokenEstimate = estimateContextTokens(contextService, params.workspaceId, params.inputBudget, session, remainingMessages);
  session.setContextTokens?.(tokenEstimate.total);
  try {
    persistence.checkpoint(session, "compressed", remainingMessages);
  } catch (error) {
    restoreEntry(contextService, sessionId, "conversation-summary", previousSummary);
    restoreEntry(contextService, sessionId, "history-archive-index", previousIndex);
    session.setContextTokens?.(previousContextTokens);
    session.compressing = false;
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const removed = typeof session.removeMessages === "function" ? session.removeMessages(archivedSeqs) : 0;
  return { ok: true, removed, previousContextTokens, remainingMessages, tokenEstimate };
}
