export enum IntentRequestType {
  FOLLOW_UP = "follow_up",
  REQUEST_MORE_TOOLS = "request_more_tools",
  KEEP_MEMORY = "keep_memory",
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

export type ToolTier = "basic" | "full";

export type DifficultyLevel = "basic" | "balanced" | "advanced";

export type IntentPredictionResult = {
  toolTier: ToolTier;
  difficulty: DifficultyLevel;
  reasoning: string;
};

// NOTE: SEARCH_MEMORY / EXECUTE_TOOL 已删除
// 文件读写/搜索/工具调用走 AI SDK streamText tool calling 路径
// 不在 IntentRequest 中定义
