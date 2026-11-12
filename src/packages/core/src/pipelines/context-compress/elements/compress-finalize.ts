import { BaseElement } from "@atom-neo/shared";
import type { ContinuationDecision, ContextCompressRequest, PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents, PipelineResultType } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "@core/task/internal-task-orchestrator";
import type { SessionPersistenceService } from "@core/session/persistence-service";
import type { ElementTask } from "@core/session/element-session";
import type { CompressFlowState } from "./types";
import type { ContextService } from "@core/context/context-service";
import { commitCompression } from "./compress-commit";
import { resumeAfterCompress } from "./compress-resume";

type CompressResult = {
  type: typeof PipelineResultType.Complete;
  task: ElementTask;
  output: string;
  chainAction?: "follow_up";
  continuationDecision?: ContinuationDecision;
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
      return this.#complete(input, request, "archive_failed", `compress: archive failed — ${input.archiveError}`);
    }
    if (input.archiveMessages.length === 0) {
      return this.#complete(input, request, "nothing_to_archive", "compress: nothing to archive");
    }
    if (input.summaryMessages.length > 0 && (!input.summary?.trim() || input.summaryError)) {
      const message = input.summaryError ?? "empty summary";
      return this.#complete(input, request, "summary_failed", `compress: summary failed — ${message}`, { error: message });
    }

    const commit = commitCompression({
      session,
      sessionId,
      summary: input.summary,
      archiveMessages: input.archiveMessages,
      archiveReceipt: input.archiveReceipt,
      contextService: this.#contextService,
      persistence: this.#persistence,
      workspaceId: this.#workspaceId,
      inputBudget: this.#inputBudget,
    });
    if (!commit.ok) {
      this.report(BusEvents.Element.Data, { step: "checkpoint failed", level: "warn", trigger: request.trigger, target: "context+messages", error: commit.error });
      return { type: PipelineResultType.Complete, task: input.task, output: `compress: checkpoint failed — ${commit.error}` };
    }

    this.report(BusEvents.Element.Data, {
      step: "checkpoint committed",
      trigger: request.trigger,
      target: "context+messages",
      archiveId: input.archiveReceipt?.archiveId,
      removedMessages: commit.removed,
      remainingMessages: commit.remainingMessages.length,
      contextSummaryUpdated: !!input.summary,
      contextArchiveIndexUpdated: !!input.archiveReceipt,
      summaryLen: input.summary?.length ?? 0,
      previousContextTokens: commit.previousContextTokens,
      snapshotTokens: commit.tokenEstimate.snapshot,
      messageTokens: commit.tokenEstimate.messages,
      contextTokens: commit.tokenEstimate.total,
      resumeConversation: request.resumeConversation,
    });

    input.session.compressing = false;
    const output = `compress: trigger=${request.trigger}, archived=${input.archiveMessages.length}, removed=${commit.removed}, summaryLen=${input.summary?.length ?? 0}, resumeConversation=${request.resumeConversation}`;

    if (request.resumeConversation) {
      const resume = resumeAfterCompress({ request, sessionId, task: input.task, report: payload => this.report(BusEvents.Element.Data, payload),
        orchestrator: this.#orchestrator });
      if (resume) return { type: PipelineResultType.Complete, task: input.task,
        output: "compress: saved, continuation awaiting chain governance", ...resume };
    } else {
      this.report(BusEvents.Element.Data, {
        step: "completed without conversation resume",
        trigger: request.trigger,
        target: "context+messages",
        sessionId,
        resumeConversation: false,
      });
    }

    return { type: PipelineResultType.Complete, task: input.task, output };
  }

  #complete(input: CompressFlowState, request: ContextCompressRequest, status: string, output: string,
    extra?: Record<string, unknown>): CompressResult {
    input.session.compressing = false;
    this.report(BusEvents.Element.Data, { step: "completed", trigger: request.trigger, target: "context+messages", status, resumeConversation: false, ...extra });
    return { type: PipelineResultType.Complete, task: input.task, output };
  }
}
