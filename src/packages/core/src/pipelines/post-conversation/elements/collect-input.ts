import { BaseElement, substringWellFormed } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { TodoItem } from "../../../session/context";
import type { ToolEffectSummary } from "../../conversation/elements/types";
import type { PostConversationFlowState } from "./types";
import { buildProgressEvidence } from "../../shared/progress-evidence";

type AssistantPart = {
  seq?: number;
  content: string;
  metadata?: Record<string, unknown>;
};

const emptyToolEffectSummary = (): ToolEffectSummary => ({
  evidence: 0,
  referenceEvidence: 0,
  stateChanged: 0,
  none: 0,
  failed: 0,
});

function collectToolEffectSummary(parts: readonly AssistantPart[]): ToolEffectSummary {
  const summary = emptyToolEffectSummary();
  for (const part of parts) {
    const value = part.metadata?.toolEffectSummary;
    if (!value || typeof value !== "object") continue;
    for (const key of Object.keys(summary) as Array<keyof ToolEffectSummary>) {
      const count = (value as Record<string, unknown>)[key];
      if (typeof count === "number" && Number.isFinite(count)) summary[key] += count;
    }
  }
  return summary;
}

export function buildAssistantReview(parts: readonly AssistantPart[], todos: readonly TodoItem[] = [], goal = "") {
  const assistantLength = parts.reduce((total, part) => total + part.content.length, 0);
  const activeTodos = todos.filter(todo => todo.status === "pending" || todo.status === "in_progress");
  const metadata = parts.at(-1)?.metadata ?? {};
  const finishReason = typeof metadata.finishReason === "string" ? metadata.finishReason : "";
  const completeDetected = metadata.completeDetected === true;
  const toolEffectSummary = collectToolEffectSummary(parts);
  const progressEvidence = buildProgressEvidence({ parts: [...parts], todos, goal });
  if (parts.length === 0) {
    return { response: "", assistantLength, activeTodoCount: activeTodos.length, finishReason, completeDetected, toolEffectSummary, progressEvidence };
  }

  if (assistantLength + parts.length - 1 <= 2400 && todos.length === 0) {
    return { response: parts.map(part => part.content).join("\n"), assistantLength, activeTodoCount: 0, finishReason, completeDetected, toolEffectSummary, progressEvidence };
  }

  const counts = Object.fromEntries(
    ["completed", "in_progress", "pending", "cancelled"].map(status => [
      status,
      todos.filter(todo => todo.status === status).length,
    ]),
  );
  const activeLabels = activeTodos
    .slice(0, 3)
    .map(todo => `${todo.status}: ${substringWellFormed(todo.content, 0, 80)}`)
    .join(" | ");
  const response = [
    `[Response State] parts=${parts.length}, chars=${assistantLength}, finishReason=${finishReason || "unknown"}, completeDetected=${completeDetected}`,
    todos.length > 0
      ? `[TODO State] completed=${counts.completed}, in_progress=${counts.in_progress}, pending=${counts.pending}, cancelled=${counts.cancelled}${activeLabels ? `; active=${activeLabels}` : ""}`
      : "[TODO State] none",
    ...progressEvidence.outputRefs.map(output => `[Output ${output.ref}${output.truncated ? "; cropped" : ""}]\n${output.text}`),
    `[Evidence Coverage] complete=${progressEvidence.reviewCoverage.complete}, omittedParts=${progressEvidence.reviewCoverage.omittedParts}`,
  ].join("\n");
  return { response, assistantLength, activeTodoCount: activeTodos.length, finishReason, completeDetected, toolEffectSummary, progressEvidence };
}

export class CollectInputElement extends BaseElement<PostConversationFlowState, PostConversationFlowState> {
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

  async doProcess(input: PostConversationFlowState): Promise<PostConversationFlowState> {
    const msgs: Array<{ seq?: number; role: string; content: string; visible?: boolean; metadata?: Record<string, unknown> }> = this.#session?.messages ?? [];
    const prediction = this.#session?.pendingPrediction ?? {};

    const budget = this.#session?.executionBudget;
    const lastUserIdx = budget ? msgs.findIndex(message => message.seq === budget.goalStartSeq) : [...msgs].reduce((idx, m, i) => m.role === "user" ? i : idx, -1);

    const parts: AssistantPart[] = [];
    for (let i = lastUserIdx + 1; i < msgs.length; i++) {
      if (msgs[i].role === "user") { if (!budget) break; else continue; }
      if (msgs[i].role === "assistant" && msgs[i].content && msgs[i].visible !== false
        && (!budget || (msgs[i].seq ?? 0) > budget.goalStartSeq) && (msgs[i] as any).pipeline !== "budget") {
        parts.push({ seq: msgs[i].seq, content: msgs[i].content, metadata: msgs[i].metadata });
      }
    }
    const userMessage = budget?.goal ?? msgs[lastUserIdx]?.content ?? "";
    const review = buildAssistantReview(parts, this.#session?.todoState ?? [], userMessage);
    const assistantResponse = review.response;

    this.report(BusEvents.Element.Data, {
      step: "collected",
      hasUser: !!userMessage,
      hasAssistant: parts.length > 0,
      assistantParts: parts.length,
      assistantLength: review.assistantLength,
      activeTodoCount: review.activeTodoCount,
      finishReason: review.finishReason,
      completeDetected: review.completeDetected,
      toolEffectSummary: review.toolEffectSummary,
      reviewCoverage: review.progressEvidence.reviewCoverage,
      taskIntent: prediction.intent ?? "conversation",
    });

    return {
      mode: "analyzing",
      task: input.task,
      session: this.#session,
      executionGoalId: budget?.goalId,
      userMessage,
      assistantResponse,
      predictedTaskIntent: prediction.intent ?? "conversation",
      stepCount: prediction.stepCount ?? 0,
      assistantParts: parts.length,
      assistantLength: review.assistantLength,
      activeTodoCount: review.activeTodoCount,
      finishReason: review.finishReason,
      completeDetected: review.completeDetected,
      toolEffectSummary: review.toolEffectSummary,
      progressEvidence: review.progressEvidence,
    };
  }
}
