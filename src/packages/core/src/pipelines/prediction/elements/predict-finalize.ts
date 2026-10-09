import { startExecutionGoal } from "../../../session/execution-budget";
import { BaseElement } from "@atom-neo/shared";
import type { IntentPredictionResult, PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import { BusEvents, PipelineResultType } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { PredictionFlowState } from "./types";
import type { SkillServiceLike } from "../../../skills/types";

export function resolveEffectiveTopic(
  prediction: Pick<IntentPredictionResult, "contextRelevance" | "topic">,
  currentTopic: string | null,
): string {
  if (currentTopic && prediction.contextRelevance !== "standalone") return currentTopic;
  return prediction.topic || currentTopic || "";
}

export class PredictFinalizeElement extends BaseElement<PredictionFlowState, PipelineResult> {
  #orchestrator: InternalTaskOrchestrator;
  #skillService?: SkillServiceLike;
  #maxGlobalRounds: number;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
    skillService?: SkillServiceLike;
    maxGlobalRounds?: number;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#maxGlobalRounds = params.maxGlobalRounds ?? 100;
    this.#skillService = params.skillService;
  }

  async doProcess(input: PredictionFlowState): Promise<PipelineResult> {
    const prediction = input.prediction ?? {
      difficulty: "medium",
      modelProfile: "balanced",
      intent: "conversation",
      contextRelevance: "standalone",
      topic: "",
      reasoning: "fallback",
    };

    const session = input.session;

    const candidateTopic = prediction.topic || "";
    const effectiveTopic = resolveEffectiveTopic(prediction, session.currentTopic);
    const resolvedPrediction = { ...prediction, topic: effectiveTopic };
    if (candidateTopic !== effectiveTopic) {
      this.report(BusEvents.Element.Data, {
        step: "topic-resolved",
        contextRelevance: prediction.contextRelevance,
        candidate: candidateTopic,
        effective: effectiveTopic,
      });
    }
    if (effectiveTopic && effectiveTopic !== session.currentTopic) {
      this.report(BusEvents.Element.Data, { step: "topic-changed", from: session.currentTopic, to: effectiveTopic });
      this.bus.emit(BusEvents.Context.TopicChanged as any, {
        sessionId: session.sessionId,
        ...(session.currentTopic ? { previousTopicId: session.currentTopic } : {}),
        topicId: effectiveTopic,
      } as any);
      this.#skillService?.clearScope?.(session.sessionId);
      session.resetForNewTopic(effectiveTopic);
    }

    // Goal lifecycle is independent of Topic; related turns retain the original goal.
    if ((!session.executionBudget && session.legacyBudgetDepth === undefined) || prediction.contextRelevance === "standalone") {
      if (prediction.contextRelevance === "standalone") { session.setTodoState?.([]); session.clearContinuationContext?.(); }
      const goal = input.task.payload?.find((part: any) => part.type === "text")?.data ?? "";
      const allowance = this.#maxGlobalRounds;
      startExecutionGoal(session, input.task.chainId ?? input.task.id, goal, allowance);
    }
    session.pendingPrediction = resolvedPrediction;

    this.report(BusEvents.Element.Data, { step: "scheduling conversation", difficulty: resolvedPrediction.difficulty, modelProfile: resolvedPrediction.modelProfile, intent: resolvedPrediction.intent, contextRelevance: resolvedPrediction.contextRelevance, topic: resolvedPrediction.topic });

    this.#orchestrator.scheduleConversation(
      session.sessionId,
      input.task.chatId,
      input.task.id,
      input.task.payload ?? [],
      undefined,
      input.task.id,
    );

    return {
      type: PipelineResultType.Complete,
      task: input.task,
      output: `prediction: difficulty=${resolvedPrediction.difficulty}, modelProfile=${resolvedPrediction.modelProfile}, intent=${resolvedPrediction.intent}, contextRelevance=${resolvedPrediction.contextRelevance}, topic=${resolvedPrediction.topic}, reasoning=${resolvedPrediction.reasoning}`,
    };
  }
}
