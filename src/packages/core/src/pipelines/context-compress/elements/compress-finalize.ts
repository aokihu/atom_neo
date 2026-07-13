import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import { archiveMessages } from "../../../session/archiver";
import type { CompressFlowState } from "./types";
import type { ContextService } from "../../../context/context-service";

export class CompressFinalizeElement extends BaseElement<CompressFlowState, PipelineResult> {
  #orchestrator: InternalTaskOrchestrator;
  #sandbox: string;
  #contextService: ContextService;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
    sandbox: string;
    contextService: ContextService;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#sandbox = params.sandbox;
    this.#contextService = params.contextService;
  }

  async doProcess(input: CompressFlowState): Promise<PipelineResult> {
    const session = input.session;
    const sessionId = session.sessionId ?? "default";

    if (input.archiveMessages.length > 0) {
      try {
        const path = archiveMessages(this.#sandbox, sessionId, input.archiveMessages);
        this.report(BusEvents.Element.Data, { step: "archived", path, count: input.archiveMessages.length });
      } catch (err: any) {
        this.report(BusEvents.Element.Data, { step: "archive failed", level: "warn", error: err.message });
      }
    }

    const before = session.messages?.length ?? 0;
    const keepCount = input.keepCount ?? 20;
    if (typeof session.replaceEarlyMessages === "function") {
      session.replaceEarlyMessages(keepCount);
    }
    const removed = before - (session.messages?.length ?? 0);

    this.report(BusEvents.Element.Data, { step: "messages cleaned", removed, keepCount, hasSummary: !!input.summary, summaryLen: input.summary?.length ?? 0 });

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

    this.report(BusEvents.Element.Data, { step: "scheduling retry conversation", sessionId, parentTaskId: input.task.parentTaskId });

    input.session.compressing = false;
    if (typeof input.session.setContextTokens === "function") {
      input.session.setContextTokens(0);
    }

    this.#orchestrator.scheduleConversation(
      sessionId,
      input.task.chatId ?? "chat",
      input.task.parentTaskId ?? input.task.id,
    );

    return {
      type: "complete",
      task: input.task,
      output: `compress: archived=${input.archiveMessages.length}, removed=${removed}, summaryLen=${input.summary?.length ?? 0}`,
    };
  }
}
