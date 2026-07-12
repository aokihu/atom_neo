import type { IntentRequest } from "@atom-neo/shared";
import type { TokenUsage } from "../../../session/context";

export type ConversationMode =
  | "initial"
  | "streaming"
  | "formatted"
  | "executing"
  | "ready_to_finalize";

export type Message = { role: string; content: string; reasoning_content?: string };
export type MemorySearchStatus = "not_started" | "found" | "empty" | "unavailable";

export type ConversationFlowState = {
  mode: ConversationMode;
  task: any;
  prompts?: Array<{ role: string; content: string; reasoning_content?: string }>;
  systemPrompt?: string;
  compiledAgentsPrompt?: string;
  skillContext?: string;
  contextData?: string;
  memorySearchAttempted?: boolean;
  memorySearchStatus?: MemorySearchStatus;
  injectedMemoryCount?: number;
  memorySuggestsSkill?: boolean;
  systemText?: string;
  userMessages?: Message[];
  responseText?: string;
  reasoningContent?: string;
  followUp?: {
    summary: string;
    nextPrompt: string;
    avoidRepeat: string;
  };
  chainAction?: "follow_up";
  intents?: IntentRequest[];
  tokenUsage?: TokenUsage;
  tokenOverflow?: boolean;
  errorStatusCode?: number;
};
