import { BaseElement, BusEvents, IntentRequestType, substringWellFormed } from "@atom-neo/shared";
import type { ContinuationDecision, PipelineEventMap, PipelineEventBus, TodoTarget } from "@atom-neo/shared";
import { hasActiveTodos, findTodoTarget, selectCurrentTodo } from "../../../session/context";
import type { TodoItem } from "../../../session/context";
import type { ElementMemory, PipelineSession } from "../../../session/element-session";
import { getTaskPayload } from "../../../session/element-session";
import { retainIntentMemory } from "../../../tools/builtin/intent";
import type { ConversationFlowState } from "./types";
import { createProgressTrace } from "../../shared/progress-evidence";
import { evaluateContinuationRules } from "./continuation-rules";
import type { ContinuationRouting } from "./continuation-rules";
import { arbitrateContinuation } from "./continuation-arbitration";
import type { ArbitrationParams } from "./continuation-arbitration";

export class CheckFollowUpElement extends BaseElement<ConversationFlowState, ConversationFlowState> {
  #memory?: ElementMemory;
  #session?: PipelineSession;
  #params: ArbitrationParams;

  constructor(params: { name: string; kind: string; bus: PipelineEventBus<PipelineEventMap>; memory?: ElementMemory; session?: PipelineSession } & ArbitrationParams) {
    super({ name: params.name, kind: "boundary", bus: params.bus });
    this.#memory = params.memory;
    this.#session = params.session;
    this.#params = params;
  }

  async doProcess(input: ConversationFlowState): Promise<ConversationFlowState> {
    if (input.mode !== "executing") return input;
    const todos: readonly TodoItem[] = this.#session?.todoState ?? [];
    const request = getTaskPayload(input.task, "continuation_request");
    const progressTrace = createProgressTrace(input, todos);
    input = { ...input, progressTrace };
    const active = hasActiveTodos(todos);
    const current = findTodoTarget(todos, input.currentTodo);
    const terminal = current?.todo.status === "completed" || current?.todo.status === "cancelled";
    const nextIndex = todos.findIndex(todo => todo.status === "in_progress");
    const pendingIndex = nextIndex >= 0 ? nextIndex : todos.findIndex(todo => todo.status === "pending");
    const next: TodoTarget | undefined = pendingIndex < 0 ? undefined : { index: pendingIndex, content: todos[pendingIndex]!.content };
    const target = current ? { index: current.index, content: current.todo.content } : input.currentTodo ?? selectCurrentTodo(todos);
    const follow = input.intents?.find(intent => intent.request === IntentRequestType.FOLLOW_UP);
    for (const intent of input.intents ?? []) {
      if (intent.request !== IntentRequestType.RETAIN_MEMORY || !this.#memory) continue;
      const id = typeof intent.params.id === "string" ? intent.params.id : "";
      retainIntentMemory(this.#memory, id);
    }
    const followUp = follow ? {
      summary: substringWellFormed(String(follow.params.summary ?? ""), 0, 500),
      nextPrompt: substringWellFormed(String(follow.params.next_prompt ?? ""), 0, 1000),
      avoidRepeat: substringWellFormed(String(follow.params.avoid_repeat ?? ""), 0, 500),
    } : undefined;
    const routing: ContinuationRouting = { todos, active, current: current ? { index: current.index, content: current.todo.content } : undefined,
      terminal, next, target, request, followUp, follow: !!follow, decisionMode: this.#params.decisionMode };

    const ruled = evaluateContinuationRules(input, routing);
    if (ruled) {
      if (ruled.stopReconciliation) return this.#stopReconciliation(input);
      return this.#withSuppression(this.#finish(input, ruled.decision), ruled.suppressPostCheck);
    }

    const outcome = await arbitrateContinuation({ input, session: this.#session, routing,
      trace: this.#trace(input), report: payload => this.report(BusEvents.Element.Data, payload), params: this.#params });
    return this.#withSuppression(this.#finish(input, outcome.decision), outcome.suppressPostCheck);
  }

  #withSuppression(state: ConversationFlowState, suppress?: boolean): ConversationFlowState {
    return suppress ? { ...state, suppressPostCheck: true } : state;
  }

  #finish(input: ConversationFlowState, continuationDecision: ContinuationDecision): ConversationFlowState {
    const chainAction = continuationDecision.kind === "resume_current" ? "follow_up"
      : continuationDecision.kind === "advance_todo" ? "continue_todo"
      : continuationDecision.kind === "reconcile_progress" ? "reconcile_todo" : undefined;
    const incomingContinuation = getTaskPayload(input.task, "continuation_request");
    if (incomingContinuation?.kind === "reconcile_progress") {
      const todoAfter = this.#session?.todoState ?? [];
      this.report(BusEvents.Element.Data, { step: "reconciliation-result", ...this.#trace(input), incomingContinuation,
        todoBefore: input.todoBefore ?? [], todoAfter: structuredClone(todoAfter), currentTodo: input.currentTodo,
        targetBefore: findTodoTarget(input.todoBefore ?? [], incomingContinuation.target),
        targetAfter: findTodoTarget(todoAfter, incomingContinuation.target),
        progressChanged: JSON.stringify(input.todoBefore ?? []) !== JSON.stringify(todoAfter),
        targetMatched: !!findTodoTarget(todoAfter, incomingContinuation.target),
        continuationDecision, chainAction: chainAction ?? "none" });
    }
    this.report(BusEvents.Element.Data, { step: "done", ...this.#trace(input), incomingContinuation, chainAction: chainAction ?? "none", ...continuationDecision,
      candidates: { finishReason: input.finishReason, intent: !!input.intents?.some(intent => intent.request === IntentRequestType.FOLLOW_UP), activeTodos: hasActiveTodos(this.#session?.todoState) } });
    return { ...input, mode: "ready_to_finalize", chainAction, continuationDecision };
  }

  #trace(input: ConversationFlowState) {
    return { sessionId: input.task.sessionId, taskId: input.task.id, parentTaskId: input.task.parentTaskId,
      rootTaskId: input.task.chainId, snapshotId: input.contextSnapshot?.id };
  }

  #stopReconciliation(input: ConversationFlowState): ConversationFlowState {
    const responseText = "任务进度尚未确认，已停止自动推进；未完成的 TODO 已保留。";
    this.report(BusEvents.Transport.Delta, { sessionId: input.task.sessionId, taskId: input.task.id, textDelta: responseText, offset: 0 });
    return { ...this.#finish(input, { kind: "finish", reason: "reconciliation_failed", source: "rules" }), responseText, suppressPostCheck: true };
  }
}
