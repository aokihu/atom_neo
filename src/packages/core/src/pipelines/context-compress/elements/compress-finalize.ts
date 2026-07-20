import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, PipelineResultType } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { ContextEntry } from "@atom-neo/shared";
import type { SessionPersistenceService } from "../../../session/persistence-service";
import type { CompressFlowState } from "./types";
import type { ContextService } from "../../../context/context-service";
import { estimateTokenCount } from "../../../context/compiler";

type CompressResult = {
  type: typeof PipelineResultType.Complete;
  task: any;
  output: string;
};

export class CompressFinalizeElement extends BaseElement<CompressFlowState, CompressResult> {
  #orchestrator: InternalTaskOrchestrator;
  #contextService: ContextService;
  #persistence: SessionPersistenceService;
  #workspaceId: string;
  #inputBudget: number;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
    contextService: ContextService;
    persistence: SessionPersistenceService;
    workspaceId?: string;
    inputBudget?: number;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#contextService = params.contextService;
    this.#persistence = params.persistence;
    this.#workspaceId = params.workspaceId ?? process.cwd();
    this.#inputBudget = params.inputBudget ?? Number.POSITIVE_INFINITY;
  }

  async doProcess(input: CompressFlowState): Promise<CompressResult> {
    const session = input.session;
    const sessionId = session.sessionId ?? "default";
    const request = input.request ?? { trigger: "manual", resumeConversation: false };

    this.report(BusEvents.Element.Data, {
      step: "finalizing",
      taskId: input.task?.id,
      sessionId,
      trigger: request.trigger,
      target: "context+messages",
      resumeConversation: request.resumeConversation,
      archiveMessages: input.archiveMessages.length,
      summaryMessages: input.summaryMessages.length,
      archiveId: input.archiveReceipt?.archiveId,
      fromSeq: input.archiveReceipt?.fromSeq,
      toSeq: input.archiveReceipt?.toSeq,
    });

    if (input.archiveError) {
      session.compressing = false;
      this.report(BusEvents.Element.Data, { step: "completed", trigger: request.trigger, target: "context+messages", status: "archive_failed", resumeConversation: false });
      return {
        type: PipelineResultType.Complete,
        task: input.task,
        output: `compress: archive failed — ${input.archiveError}`,
      };
    }

    if (input.archiveMessages.length === 0) {
      session.compressing = false;
      this.report(BusEvents.Element.Data, { step: "completed", trigger: request.trigger, target: "context+messages", status: "nothing_to_archive", resumeConversation: false });
      return {
        type: PipelineResultType.Complete,
        task: input.task,
        output: "compress: nothing to archive",
      };
    }

    if (input.summaryMessages.length > 0 && (!input.summary?.trim() || input.summaryError)) {
      session.compressing = false;
      this.report(BusEvents.Element.Data, { step: "completed", trigger: request.trigger, target: "context+messages", status: "summary_failed", resumeConversation: false, error: input.summaryError ?? "empty summary" });
      return {
        type: PipelineResultType.Complete,
        task: input.task,
        output: `compress: summary failed — ${input.summaryError ?? "empty summary"}`,
      };
    }

    const previousSummary = this.#contextService.get("session", { sessionId }, "conversation-summary");
    const previousIndex = this.#contextService.get("session", { sessionId }, "history-archive-index");

    if (input.summary) {
      const label = "[对话历史摘要]";
      this.#contextService.put({
        scope: "session",
        owner: { sessionId },
        entry: {
          key: "conversation-summary",
          source: "context-compress",
          channel: "messages",
          trust: "untrusted",
          priority: 700,
          content: [{ role: "assistant", content: `${label}\n${input.summary}` }],
        },
      });
    }
    if (input.archiveReceipt) {
      this.#contextService.put({
        scope: "session",
        owner: { sessionId },
        entry: {
          key: "history-archive-index",
          source: "session-history",
          channel: "runtime",
          trust: "trusted",
          priority: 500,
          content: this.#persistence.getArchiveIndex(sessionId),
        },
      });
    }

    const archivedSeqs = input.archiveMessages.flatMap(message =>
      message.seq === undefined ? [] : [message.seq]);
    const archived = new Set(archivedSeqs);
    const remainingMessages = (session.messages ?? []).filter((message: { seq?: number }) =>
      message.seq === undefined || !archived.has(message.seq));
    const previousContextTokens = session.contextTokens ?? 0;
    const tokenEstimate = this.#estimateContextTokens(session, remainingMessages);
    session.setContextTokens?.(tokenEstimate.total);
    try {
      this.#persistence.checkpoint(session, "compressed", remainingMessages);
    } catch (error) {
      this.#restoreEntry(sessionId, "conversation-summary", previousSummary);
      this.#restoreEntry(sessionId, "history-archive-index", previousIndex);
      session.setContextTokens?.(previousContextTokens);
      session.compressing = false;
      const message = error instanceof Error ? error.message : String(error);
      this.report(BusEvents.Element.Data, { step: "checkpoint failed", level: "warn", trigger: request.trigger, target: "context+messages", error: message });
      return { type: PipelineResultType.Complete, task: input.task, output: `compress: checkpoint failed — ${message}` };
    }

    const removed = typeof session.removeMessages === "function"
      ? session.removeMessages(archivedSeqs)
      : 0;

    this.report(BusEvents.Element.Data, {
      step: "checkpoint committed",
      trigger: request.trigger,
      target: "context+messages",
      archiveId: input.archiveReceipt?.archiveId,
      removedMessages: removed,
      remainingMessages: remainingMessages.length,
      contextSummaryUpdated: !!input.summary,
      contextArchiveIndexUpdated: !!input.archiveReceipt,
      summaryLen: input.summary?.length ?? 0,
      previousContextTokens,
      snapshotTokens: tokenEstimate.snapshot,
      messageTokens: tokenEstimate.messages,
      contextTokens: tokenEstimate.total,
      resumeConversation: request.resumeConversation,
    });

    input.session.compressing = false;

    if (request.resumeConversation) {
      this.report(BusEvents.Element.Data, {
        step: "conversation resume scheduled",
        trigger: request.trigger,
        sessionId,
        parentTaskId: input.task.parentTaskId,
      });
      this.#orchestrator.scheduleConversation(
        sessionId,
        input.task.chatId ?? "chat",
        input.task.parentTaskId ?? input.task.id,
        [{
          type: "text",
          data: "请根据对话摘要和最近消息，从被截断处继续；不要重复已经完成的内容。",
        }],
        undefined,
        input.task.id,
      );
    } else {
      this.report(BusEvents.Element.Data, {
        step: "completed without conversation resume",
        trigger: request.trigger,
        target: "context+messages",
        sessionId,
        resumeConversation: false,
      });
    }

    return {
      type: PipelineResultType.Complete,
      task: input.task,
      output: `compress: trigger=${request.trigger}, archived=${input.archiveMessages.length}, removed=${removed}, summaryLen=${input.summary?.length ?? 0}, resumeConversation=${request.resumeConversation}`,
    };
  }

  #restoreEntry(sessionId: string, key: string, previous?: Readonly<ContextEntry>): void {
    if (!previous) {
      this.#contextService.remove("session", { sessionId }, key);
      return;
    }
    const { revision: _revision, ...entry } = previous;
    this.#contextService.put({ scope: "session", owner: { sessionId }, entry });
  }

  #estimateContextTokens(session: any, messages: readonly any[]): {
    snapshot: number;
    messages: number;
    total: number;
  } {
    const snapshot = this.#contextService.createSnapshot({
      workspaceId: this.#workspaceId,
      sessionId: session.sessionId ?? "default",
      ...(session.currentTopic ? { topicId: session.currentTopic } : {}),
      inputBudget: this.#inputBudget,
    });
    const snapshotTokens = this.#contextService.inspectSnapshot(snapshot.id)?.estimatedTokens ?? 0;
    this.#contextService.releaseSnapshot(snapshot.id);
    const visibleMessages = messages
      .filter(message => message.visible !== false)
      .map(message => ({
        role: message.role,
        content: message.content,
        ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {}),
      }));
    const messageTokens = visibleMessages.length > 0 ? estimateTokenCount(visibleMessages) : 0;
    return {
      snapshot: snapshotTokens,
      messages: messageTokens,
      total: snapshotTokens + messageTokens,
    };
  }
}
