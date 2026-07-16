import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, PipelineResultType } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { ContextEntry } from "@atom-neo/shared";
import type { SessionPersistenceService } from "../../../session/persistence-service";
import type { CompressFlowState } from "./types";
import type { ContextService } from "../../../context/context-service";

type CompressResult = {
  type: typeof PipelineResultType.Complete;
  task: any;
  output: string;
};

export class CompressFinalizeElement extends BaseElement<CompressFlowState, CompressResult> {
  #orchestrator: InternalTaskOrchestrator;
  #contextService: ContextService;
  #persistence: SessionPersistenceService;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
    contextService: ContextService;
    persistence: SessionPersistenceService;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#contextService = params.contextService;
    this.#persistence = params.persistence;
  }

  async doProcess(input: CompressFlowState): Promise<CompressResult> {
    const session = input.session;
    const sessionId = session.sessionId ?? "default";

    if (input.archiveError) {
      session.compressing = false;
      return {
        type: PipelineResultType.Complete,
        task: input.task,
        output: `compress: archive failed — ${input.archiveError}`,
      };
    }

    if (input.archiveMessages.length === 0) {
      session.compressing = false;
      return {
        type: PipelineResultType.Complete,
        task: input.task,
        output: "compress: nothing to archive",
      };
    }

    if (input.summaryMessages.length > 0 && (!input.summary?.trim() || input.summaryError)) {
      session.compressing = false;
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
    try {
      this.#persistence.checkpoint(session, "compressed", remainingMessages);
    } catch (error) {
      this.#restoreEntry(sessionId, "conversation-summary", previousSummary);
      this.#restoreEntry(sessionId, "history-archive-index", previousIndex);
      session.compressing = false;
      const message = error instanceof Error ? error.message : String(error);
      this.report(BusEvents.Element.Data, { step: "checkpoint failed", level: "warn", error: message });
      return { type: PipelineResultType.Complete, task: input.task, output: `compress: checkpoint failed — ${message}` };
    }

    const removed = typeof session.removeMessages === "function"
      ? session.removeMessages(archivedSeqs)
      : 0;

    this.report(BusEvents.Element.Data, { step: "messages cleaned", removed, keepCount: remainingMessages.length, hasSummary: !!input.summary, summaryLen: input.summary?.length ?? 0 });

    this.report(BusEvents.Element.Data, { step: "scheduling retry conversation", sessionId, parentTaskId: input.task.parentTaskId });

    input.session.compressing = false;

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

    return {
      type: PipelineResultType.Complete,
      task: input.task,
      output: `compress: archived=${input.archiveMessages.length}, removed=${removed}, summaryLen=${input.summary?.length ?? 0}`,
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
}
