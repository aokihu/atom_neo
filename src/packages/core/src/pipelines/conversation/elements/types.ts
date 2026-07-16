import type { ContextOwner, ContextSnapshot, ConversationContinuationAction, IntentRequest } from "@atom-neo/shared";
import type { TokenUsage } from "../../../session/context";

export type ConversationMode =
  | "initial"
  | "streaming"
  | "context_recorded"
  | "formatted"
  | "executing"
  | "ready_to_finalize";

export type Message = { role: string; content: string; reasoning_content?: string };
export type MemorySearchStatus = "not_started" | "found" | "empty" | "unavailable";

export const appendCurrentUserMessage = (messages: Message[], content?: string): Message[] => {
  const latest = messages.at(-1);
  if (content && (latest?.role !== "user" || latest.content !== content)) {
    messages.push({ role: "user", content });
  }
  return messages;
};

export type ConversationFlowState = {
  mode: ConversationMode;
  task: any;
  prompts?: Array<{ role: string; content: string; reasoning_content?: string }>;
  systemPrompt?: string;
  compiledAgentsPrompt?: string;
  skillContext?: string;
  skillContextRevision?: number;
  contextData?: string;
  contextOwner?: ContextOwner;
  contextSnapshot?: ContextSnapshot;
  contextSnapshotAccepted?: boolean;
  memorySearchAttempted?: boolean;
  memorySearchStatus?: MemorySearchStatus;
  injectedMemoryCount?: number;
  systemText?: string;
  userMessages?: Message[];
  responseText?: string;
  reasoningContent?: string;
  followUp?: {
    summary: string;
    nextPrompt: string;
    avoidRepeat: string;
  };
  chainAction?: ConversationContinuationAction;
  intents?: IntentRequest[];
  tokenUsage?: TokenUsage;
  tokenOverflow?: boolean;
  errorStatusCode?: number;
  finishReason?: string;
  completeDetected?: boolean;
};
