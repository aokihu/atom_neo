import { BaseElement, BusEvents } from "@atom-neo/shared";
import type { PipelineEventBus, PipelineEventMap } from "@atom-neo/shared";
import type { SessionPersistenceService } from "../../../session/persistence-service";
import type { CompressFlowState } from "./types";

export class CompressArchiveElement extends BaseElement<CompressFlowState, CompressFlowState> {
  #persistence: SessionPersistenceService;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    persistence: SessionPersistenceService;
  }) {
    super({ name: params.name, kind: "transform", bus: params.bus });
    this.#persistence = params.persistence;
  }

  async doProcess(input: CompressFlowState): Promise<CompressFlowState> {
    if (input.mode !== "archiving") return input;
    if (input.archiveMessages.length === 0) {
      return { ...input, mode: "summarizing", summaryText: "" };
    }

    try {
      const archiveReceipt = this.#persistence.archiveMessages(
        input.session.sessionId ?? "default",
        input.archiveMessages,
      ) ?? undefined;
      this.report(BusEvents.Element.Data, {
        step: "archived",
        archiveId: archiveReceipt?.archiveId,
        count: archiveReceipt?.count ?? 0,
      });
      return { ...input, mode: "summarizing", archiveReceipt };
    } catch (error) {
      const archiveError = error instanceof Error ? error.message : String(error);
      this.report(BusEvents.Element.Data, { step: "archive failed", level: "warn", error: archiveError });
      return { ...input, mode: "finalizing", archiveError, summary: "" };
    }
  }
}
