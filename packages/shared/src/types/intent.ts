import type { TaskToolCall } from "./task";

export enum IntentRequestType {
  SEARCH_MEMORY = "search_memory",
  EXECUTE_TOOL = "execute_tool",
  FOLLOW_UP = "follow_up",
  COMPLETE = "complete",
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

export type SearchMemoryIntentRequest = IntentRequest & {
  request: IntentRequestType.SEARCH_MEMORY;
  params: {
    words: string;
    scope?: string;
    limit?: number;
  };
};

export type ExecuteToolIntentRequest = IntentRequest & {
  request: IntentRequestType.EXECUTE_TOOL;
  params: {
    toolRequests: TaskToolCall[];
  };
};
