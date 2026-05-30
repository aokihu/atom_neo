import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import { archiveMessages } from "../../../session/archiver";
import type { CompressFlowState } from "./types";

export class CompressFinalizeElement extends BaseElement<CompressFlowState, PipelineResult> {
  #orchestrator: InternalTaskOrchestrator;
  #sandbox: string;
  #logger: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
    sandbox: string;
    logger?: any;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#sandbox = params.sandbox;
    this.#logger = params.logger;
  }

  async doProcess(input: CompressFlowState): Promise<PipelineResult> {
    const session = input.session;
    const sessionId = session.sessionId ?? "default";

    if (input.archiveMessages.length > 0) {
      try {
        const path = archiveMessages(this.#sandbox, sessionId, input.archiveMessages);
        this.#logger?.info("compress-finalize: archived", { path, count: input.archiveMessages.length });
      } catch (err: any) {
        this.#logger?.warn("compress-finalize: archive failed", { error: err.message });
      }
    }

    const before = session.messages?.length ?? 0;
    if (typeof session.replaceEarlyMessages === "function") {
      session.replaceEarlyMessages(20);
    }
    const removed = before - (session.messages?.length ?? 0);

    this.#logger?.debug("compress-finalize: messages cleaned", { removed });

    if (input.summary) {
      const label = "[对话历史摘要]";
      session.conversationSummary = `${label}\n${input.summary}`;
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
