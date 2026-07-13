import { BaseElement } from "@atom-neo/shared";
import type { PipelineEventMap, PipelineEventBus, PipelineResult } from "@atom-neo/shared";
import { BusEvents } from "@atom-neo/shared";
import type { InternalTaskOrchestrator } from "../../../task/internal-task-orchestrator";
import type { PredictionFlowState } from "./types";
import type { SkillServiceLike } from "../../../skills/types";

export class PredictFinalizeElement extends BaseElement<PredictionFlowState, PipelineResult> {
  #orchestrator: InternalTaskOrchestrator;
  #skillService?: SkillServiceLike;

  constructor(params: {
    name: string;
    kind: string;
    bus: PipelineEventBus<PipelineEventMap>;
    orchestrator: InternalTaskOrchestrator;
    skillService?: SkillServiceLike;
  }) {
    super({ name: params.name, kind: "sink", bus: params.bus });
    this.#orchestrator = params.orchestrator;
    this.#skillService = params.skillService;
  }

  async doProcess(input: PredictionFlowState): Promise<PipelineResult> {
    const prediction = input.prediction ?? {
      difficulty: "medium",
      modelProfile: "balanced",
      intent: "conversation",
      contextRelevance: "standalone",
      memoryQuery: "",
      topic: "",
      reasoning: "fallback",
    };

    const session = input.session;

    const newTopic = prediction.topic || "";
    if (newTopic && newTopic !== session.currentTopic) {
      this.report(BusEvents.Element.Data, { step: "topic-changed", from: session.currentTopic, to: newTopic });
      this.bus.emit(BusEvents.Context.TopicChanged as any, {
        sessionId: session.sessionId,
        ...(session.currentTopic ? { previousTopicId: session.currentTopic } : {}),
        topicId: newTopic,
      } as any);
    }
    if (!session.currentTopic || (newTopic && newTopic !== session.currentTopic)) {
      this.#skillService?.clearScope?.(session.sessionId);
      session.resetForNewTopic(newTopic);
    }

    session.pendingPrediction = prediction;

    this.report(BusEvents.Element.Data, { step: "scheduling conversation", difficulty: prediction.difficulty, modelProfile: prediction.modelProfile, intent: prediction.intent, contextRelevance: prediction.contextRelevance, memoryQuery: prediction.memoryQuery, topic: prediction.topic });

    this.#orchestrator.scheduleConversation(
      session.sessionId,
      input.task.chatId,
      input.task.id,
      input.task.payload ?? [],
    );

    return {
      type: "complete",
      task: input.task,
      output: `prediction: difficulty=${prediction.difficulty}, modelProfile=${prediction.modelProfile}, intent=${prediction.intent}, contextRelevance=${prediction.contextRelevance}, memoryQuery=${prediction.memoryQuery}, topic=${prediction.topic}, reasoning=${prediction.reasoning}`,
    };
  }
}
