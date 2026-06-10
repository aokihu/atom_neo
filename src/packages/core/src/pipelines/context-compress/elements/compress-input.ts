import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { CompressFlowState } from "./types";

const KEEP_COUNT = 20;
const MAX_MSG_LEN = 2000;

function resolveStrategy(ratio: number): { keepCount: number; maxMsgLen: number; summaryMaxTokens: number } {
  if (ratio >= 1.2) return { keepCount: 1, maxMsgLen: 200, summaryMaxTokens: 1600 };
  if (ratio >= 0.9) return { keepCount: 2, maxMsgLen: 300, summaryMaxTokens: 1200 };
  if (ratio >= 0.6) return { keepCount: 5, maxMsgLen: 500, summaryMaxTokens: 800 };
  if (ratio >= 0.3) return { keepCount: 10, maxMsgLen: 1000, summaryMaxTokens: 600 };
  return { keepCount: 20, maxMsgLen: 2000, summaryMaxTokens: 400 };
}

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

    const ratio = this.#session?.pendingCompressRatio ?? 0.5;
    const strategy = resolveStrategy(ratio);

    const safeCount = this.#session?.lastSafeMsgCount ?? 0;
    const keepFromSafe = safeCount > 0 ? dialog.slice(safeCount) : [];
    const keepCountFromSafe = keepFromSafe.length > 0 ? keepFromSafe.length : Math.min(strategy.keepCount, dialog.length);
    const toCompress = dialog.slice(0, dialog.length - keepCountFromSafe);
    const toKeep = dialog.slice(-keepCountFromSafe);

    for (const m of toKeep) {
      if (m.content.length > strategy.maxMsgLen) {
        m.content = m.content.slice(0, strategy.maxMsgLen) + "...(truncated)";
      }
    }

    const summaryText = toCompress
      .map(m => `${m.role}: ${m.content}`)
      .join("\n");

    this.report(BusEvents.Element.Data, { step: "done", totalMsgs: dialog.length, toCompress: toCompress.length, keep: keepCountFromSafe, safeCount, ratio: ratio.toFixed(2), strategy: JSON.stringify(strategy), mode: safeCount > 0 ? "safe_boundary" : "default" });
    return {
      mode: "summarizing",
      task: input.task,
      session: this.#session,
      archiveMessages: toCompress,
      summaryText,
      summaryMaxTokens: strategy.summaryMaxTokens,
    };
  }
}
