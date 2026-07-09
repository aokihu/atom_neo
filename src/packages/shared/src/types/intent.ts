export enum IntentRequestType {
  FOLLOW_UP = "follow_up",
  RETAIN_MEMORY = "retain_memory",
}

export enum IntentRequestSource {
  CONVERSATION = "conversation",
  PREDICTION = "prediction",
}

export type IntentRequest = {
  source: IntentRequestSource;
  request: IntentRequestType;
  intent: string;
  params: Record<string, unknown>;
};

export type FollowUpIntentRequest = IntentRequest & {
  request: IntentRequestType.FOLLOW_UP;
  params: {
    summary: string;
    nextPrompt: string;
    avoidRepeat: string;
  };
};

export type DifficultyLevel = "easy" | "medium" | "hard" | "mygod";
export type ModelProfile = "basic" | "balanced" | "advanced";

export type IntentClass = "instruction" | "question" | "creative" | "conversation";
export type ContextRelevance = "standalone" | "follow_up" | "continuation";

export type IntentPredictionResult = {
  difficulty: DifficultyLevel;
  modelProfile: ModelProfile;
  intent: IntentClass;
  contextRelevance: ContextRelevance;
  topic: string;
  reasoning: string;
};

// NOTE: SEARCH_MEMORY / EXECUTE_TOOL 已删除
// 文件读写/搜索/工具调用走 AI SDK streamText tool calling 路径
// 不在 IntentRequest 中定义
