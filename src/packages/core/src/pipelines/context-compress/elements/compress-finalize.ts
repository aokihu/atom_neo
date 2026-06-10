import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import { archiveMessages } from "../../../session/archiver";
import type { CompressFlowState } from "./types";

export class CompressFinalizeElement extends BaseElement<CompressFlowState, PipelineResult> {
  #orchestrator: InternalTaskOrchestrator;
  #sandbox: string;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
    sandbox: string;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#sandbox = params.sandbox;
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
    if (typeof session.replaceEarlyMessages === "function") {
      session.replaceEarlyMessages(20);
    }
    const removed = before - (session.messages?.length ?? 0);

    this.report(BusEvents.Element.Data, { step: "messages cleaned", removed, hasSummary: !!input.summary, summaryLen: input.summary?.length ?? 0 });

    if (input.summary) {
      const label = "[对话历史摘要]";
      session.conversationSummary = `${label}\n${input.summary}`;
    }

    this.report(BusEvents.Element.Data, { step: "scheduling retry conversation", sessionId, parentTaskId: input.task.parentTaskId });

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
