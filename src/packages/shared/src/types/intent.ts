export enum IntentRequestType {
  FOLLOW_UP = "follow_up",   // 仅 follow_up 走 IntentRequest 解析（尾部隐蔽调度）
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

// NOTE: SEARCH_MEMORY / EXECUTE_TOOL 已删除
// 文件读写/搜索/工具调用走 AI SDK streamText tool calling 路径
// 不在 IntentRequest 中定义
