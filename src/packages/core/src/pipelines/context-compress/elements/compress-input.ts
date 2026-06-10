import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { CompressFlowState } from "./types";

const KEEP_COUNT = 20;
const MAX_MSG_LEN = 2000;

export class CompressInputElement extends BaseElement<any, CompressFlowState> {
  #session: any;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    session: any;
  }) {
    super({ name: params.name, kind: "source", bus: params.bus });
    this.#session = params.session;
  }

  async doProcess(input: any): Promise<CompressFlowState> {
    const msgs: Array<{ role: string; content: string; timestamp: number }> =
      this.#session?.messages ?? [];
    const dialog = msgs.filter(m => m.role === "user" || m.role === "assistant");

    const safeCount = this.#session?.lastSafeMsgCount ?? 0;
    const keepFromSafe = safeCount > 0 ? dialog.slice(safeCount) : [];
    const keepCount = keepFromSafe.length > 0
      ? keepFromSafe.length
      : Math.min(KEEP_COUNT, dialog.length);
    const toCompress = dialog.slice(0, dialog.length - keepCount);
    const toKeep = dialog.slice(-keepCount);

    for (const m of toKeep) {
      if (m.content.length > MAX_MSG_LEN) {
        m.content = m.content.slice(0, MAX_MSG_LEN) + "...(truncated)";
      }
    }

    const summaryText = toCompress
      .map(m => `${m.role}: ${m.content}`)
      .join("\n");

    this.report(BusEvents.Element.Data, { step: "done", totalMsgs: dialog.length, toCompress: toCompress.length, keep: keepCount, safeCount, mode: safeCount > 0 ? "safe_boundary" : "default" });
    return {
      mode: "summarizing",
      task: input.task,
      session: this.#session,
      archiveMessages: toCompress,
      summaryText,
    };
  }
}
