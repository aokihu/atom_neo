import type { SessionMessage } from "@atom-neo/shared";
import { isPromptEligibleMessage } from "./message-policy";

/** Provider-facing message shape produced from prompts or session messages. */
export type ProjectedMessage = {
  role: string;
  content: string;
  reasoning_content?: string;
};

/** Message-like input accepted by the projection; reasoning may use either wire name. */
export type ProjectableMessage = {
  role: string;
  content: string;
  reasoningContent?: string;
  reasoning_content?: string;
};

/** Append the current user request once, without mutating the input array. */
export function appendCurrentUserMessage(
  messages: readonly ProjectedMessage[],
  content?: string,
): ProjectedMessage[] {
  const latest = messages.at(-1);
  if (!content || (latest?.role === "user" && latest.content === content)) return [...messages];
  return [...messages, { role: "user", content }];
}

/**
 * Project one message into the pipeline prompt shape. Reasoning is kept by
 * default (continuation requests need it); pass `keepReasoning: false` for the
 * formatted conversation history.
 */
export function projectPipelineMessage(
  message: ProjectableMessage,
  options: { keepReasoning?: boolean } = {},
): ProjectedMessage {
  const reasoning = message.reasoningContent ?? message.reasoning_content;
  return {
    role: message.role,
    content: message.content,
    ...(options.keepReasoning !== false && reasoning ? { reasoning_content: reasoning } : {}),
  };
}

/** Reuse the single eligibility rule from `message-policy`. */
export function selectPromptEligibleMessages<
  T extends Pick<SessionMessage, "role" | "content" | "metadata" | "visible">,
>(messages: readonly T[]): T[] {
  return messages.filter(message => isPromptEligibleMessage(message));
}
