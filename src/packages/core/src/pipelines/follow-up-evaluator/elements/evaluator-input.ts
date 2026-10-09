import { BaseElement, BusEvents } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import type { ToolRecordStore } from "../../../tools/tool-record-store";
import { buildProgressEvidence } from "../../shared/progress-evidence";
import type { EvaluatorFlowState } from "./types";

export class EvaluatorInputElement extends BaseElement<any, EvaluatorFlowState> {
  #session: any;
  #tools?: ToolRecordStore;

  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap>; session: any; toolRecordStore?: ToolRecordStore }) {
    super({ name: params.name, kind: "source", bus: params.bus });
    this.#session = params.session;
    this.#tools = params.toolRecordStore;
  }

  async doProcess(input: any): Promise<EvaluatorFlowState> {
    const budget = this.#session.executionBudget;
    const check = input.task?.payload?.find((part: any) => part.type === "budget_check")?.data;
    const messages = this.#session.messages ?? [];
    const parts = messages.filter((message: any) => message.role === "assistant" && message.pipeline === "conversation"
      && (message.seq ?? 0) >= (budget?.windowStartSeq ?? 0));
    const taskIds = new Set((budget?.releasedTaskIds ?? []).slice(-(budget?.localUsed ?? 0)));
    const groups = this.#tools?.exportSession(this.#session.sessionId).filter(group => taskIds.has(group.taskId));
    const allRecords = groups?.flatMap(group => group.records) ?? [];
    const evidence = {
      originalGoal: budget?.goal ?? "", goalId: budget?.goalId, windowId: budget?.windowId,
      budgets: budget ? { globalUsed: budget.globalUsed, globalAllowance: budget.globalAllowance, localUsed: budget.localUsed } : null,
      progress: buildProgressEvidence({ goal: budget?.goal ?? "", parts, todos: this.#session.todoState ?? [], before: budget?.todoBaseline ?? [] }),
      tools: allRecords.slice(-24).map(record => ({ id: record.id, tool: record.toolName, ok: record.metadata.ok,
        input: record.inputSummary, result: record.resultSummary, error: record.metadata.error,
        detailTruncated: record.truncated ?? false })),
      evidenceMissing: !budget || budget.legacyEvidenceMissing === true,
      toolCoverage: { available: !!this.#tools, provided: Math.min(24, allRecords.length), total: allRecords.length,
        summariesBounded: true, omitted: Math.max(0, allRecords.length - 24) },
      pendingRequest: budget?.pendingTask?.payload ?? [],
    };
    this.report(BusEvents.Element.Data, { step: "window-input", taskId: input.task?.id, budgetCheck: check, evidence });
    return { mode: "analyzing", task: input.task, session: this.#session, budgetCheck: check, evidence,
      recentSummary: JSON.stringify(evidence), abortSignal: input.abortSignal };
  }
}
