import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { TodoItem } from "../../../session/context";
import type { PostConversationFlowState } from "./types";

type AssistantPart = {
  content: string;
  metadata?: Record<string, unknown>;
};

export function buildAssistantReview(parts: readonly AssistantPart[], todos: readonly TodoItem[] = []) {
  const assistantLength = parts.reduce((total, part) => total + part.content.length, 0);
  const activeTodos = todos.filter(todo => todo.status === "pending" || todo.status === "in_progress");
  const metadata = parts.at(-1)?.metadata ?? {};
  const finishReason = typeof metadata.finishReason === "string" ? metadata.finishReason : "";
  const completeDetected = metadata.completeDetected === true;
  if (parts.length === 0) {
    return { response: "", assistantLength, activeTodoCount: activeTodos.length, finishReason, completeDetected };
  }

  if (assistantLength + parts.length - 1 <= 2400 && todos.length === 0) {
    return { response: parts.map(part => part.content).join("\n"), assistantLength, activeTodoCount: 0, finishReason, completeDetected };
  }

  const counts = Object.fromEntries(
    ["completed", "in_progress", "pending", "cancelled"].map(status => [
      status,
      todos.filter(todo => todo.status === status).length,
    ]),
  );
  const activeLabels = activeTodos
    .slice(0, 3)
    .map(todo => `${todo.status}: ${todo.content.slice(0, 80)}`)
    .join(" | ");
  const response = [
    `[Response State] parts=${parts.length}, chars=${assistantLength}, finishReason=${finishReason || "unknown"}, completeDetected=${completeDetected}`,
    todos.length > 0
      ? `[TODO State] completed=${counts.completed}, in_progress=${counts.in_progress}, pending=${counts.pending}, cancelled=${counts.cancelled}${activeLabels ? `; active=${activeLabels}` : ""}`
      : "[TODO State] none",
    "[Response Head]",
    parts[0].content.slice(0, 700),
    "[Response Tail]",
    parts.at(-1)!.content.slice(-1300),
  ].join("\n");
  return { response, assistantLength, activeTodoCount: activeTodos.length, finishReason, completeDetected };
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

  async doProcess(_input: PostConversationFlowState): Promise<PostConversationFlowState> {
    const msgs: Array<{ role: string; content: string; visible?: boolean; metadata?: Record<string, unknown> }> = this.#session?.messages ?? [];
    const prediction = this.#session?.pendingPrediction ?? {};

    const lastUserIdx = [...msgs].reduce((idx, m, i) => m.role === "user" ? i : idx, -1);

    const parts: AssistantPart[] = [];
    for (let i = lastUserIdx + 1; i < msgs.length; i++) {
      if (msgs[i].role === "user") break;
      if (msgs[i].role === "assistant" && msgs[i].content && msgs[i].visible !== false) {
        parts.push({ content: msgs[i].content, metadata: msgs[i].metadata });
      }
    }
    const review = buildAssistantReview(parts, this.#session?.todoState ?? []);
    const assistantResponse = review.response;
    const userMessage = msgs[lastUserIdx]?.content ?? "";

    this.report(BusEvents.Element.Data, {
      step: "collected",
      hasUser: !!userMessage,
      hasAssistant: parts.length > 0,
      assistantParts: parts.length,
      assistantLength: review.assistantLength,
      activeTodoCount: review.activeTodoCount,
      finishReason: review.finishReason,
      completeDetected: review.completeDetected,
      taskIntent: prediction.intent ?? "conversation",
    });

    return {
      mode: "analyzing",
      task: null,
      session: this.#session,
      userMessage,
      assistantResponse,
      predictedTaskIntent: prediction.intent ?? "conversation",
      stepCount: prediction.stepCount ?? 0,
      assistantParts: parts.length,
      assistantLength: review.assistantLength,
      activeTodoCount: review.activeTodoCount,
      finishReason: review.finishReason,
      completeDetected: review.completeDetected,
    };
  }
}
